import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { startTestApp, makeClient, signUp, signUpCreator, listingForm, PNG, PASSWORD } from './helpers.js';

let app;
let seller;
let buyer;
let other;
let admin;
let listingId;
let imageId;
const paidBytes = crypto.randomBytes(50_000);
const freeBytes = crypto.randomBytes(5_000);

before(async () => {
  app = await startTestApp();
  seller = await signUpCreator(app.base, 'seller_one');
  buyer = await signUp(app.base, 'buyer_one');
  other = await signUp(app.base, 'someone_else');
  admin = await signUp(app.base, 'admin_user', 'admin@fileshelf.test');
});
after(() => app.stop());

test('sign up, sign in, sign out', async () => {
  const anon = makeClient(app.base);
  assert.equal((await anon.get('/api/auth/me')).body.user, null);

  const bad = await anon.post('/api/auth/signup', { json: { username: 'x', email: 'nope', password: 'short' } });
  assert.equal(bad.status, 400);
  const dupe = await anon.post('/api/auth/signup', { json: { username: 'SELLER_ONE', email: 'new@example.test', password: PASSWORD } });
  assert.equal(dupe.status, 409, 'usernames are case-insensitive');

  const wrong = await anon.post('/api/auth/login', { json: { email: 'seller_one@example.test', password: 'wrong-password-123' } });
  assert.equal(wrong.status, 401);
  const unknown = await anon.post('/api/auth/login', { json: { email: 'nobody@example.test', password: 'wrong-password-123' } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, wrong.body.error, 'same message for unknown email and wrong password');

  const ok = await anon.post('/api/auth/login', { json: { email: 'seller_one@example.test', password: PASSWORD } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal((await anon.get('/api/auth/me')).body.user.username, 'seller_one');
  assert.equal(ok.body.user.password_hash, undefined);
  await anon.post('/api/auth/logout', { json: {} });
  assert.equal((await anon.get('/api/auth/me')).body.user, null);
});

test('login is rate limited', async () => {
  const c = makeClient(app.base);
  let last;
  for (let i = 0; i < 10; i++) last = await c.post('/api/auth/login', { json: { email: 'ratelimit@example.test', password: 'wrong-password-123' } });
  assert.equal(last.status, 429);
});

test('the admin email starts the site off with an admin', async () => {
  assert.equal((await admin.get('/api/auth/me')).body.user.role, 'admin');
  assert.equal((await seller.get('/api/auth/me')).body.user.role, 'creator');
  assert.equal((await buyer.get('/api/auth/me')).body.user.role, 'user');
  assert.equal((await seller.get('/api/admin/queue')).status, 403);
  assert.equal((await makeClient(app.base).get('/api/admin/queue')).status, 401);
});

test('creating a listing needs sign-in and valid input', async () => {
  const anon = makeClient(app.base);
  const noAuth = await anon.post('/api/listings', { form: listingForm({ file: { name: 'a.zip', data: paidBytes } }) });
  assert.equal(noAuth.status, 401);
  // A plain account has to set up a creator profile first.
  const plain = await buyer.post('/api/listings', { form: listingForm({ file: { name: 'a.zip', data: paidBytes } }) });
  assert.equal(plain.status, 403);

  const cases = [
    ['no file', listingForm({})],
    ['blocked extension', listingForm({ file: { name: 'tool.exe', data: paidBytes } })],
    ['price too low', listingForm({ file: { name: 'a.zip', data: paidBytes }, price: '0.10' })],
    ['price not a number', listingForm({ file: { name: 'a.zip', data: paidBytes }, price: 'abc' })],
    ['unknown game', listingForm({ file: { name: 'a.zip', data: paidBytes }, game: 'nope' })],
    ['fake image', listingForm({ file: { name: 'a.zip', data: paidBytes }, images: [{ name: 'x.png', data: Buffer.from('not a png') }] })],
    ['no agreement', listingForm({ file: { name: 'a.zip', data: paidBytes }, extra: { agree: 'no' } })],
    ['unknown category', listingForm({ file: { name: 'a.zip', data: paidBytes }, category: 'nope' })],
  ];
  for (const [label, form] of cases) {
    const res = await seller.post('/api/listings', { form });
    assert.equal(res.status, 400, `${label}: ${JSON.stringify(res.body)}`);
  }
  // Nothing from the rejected attempts should be left behind.
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 0);
  assert.deepEqual(fs.readdirSync(app.cfg.tmpDir), []);
});

test('a seller can submit a listing, which waits for review', async () => {
  const res = await seller.post('/api/listings', {
    form: listingForm({
      file: { name: 'full-pack.zip', data: paidBytes },
      free: { name: 'free-pack.zip', data: freeBytes },
      images: [{ name: 'one.png', data: PNG }],
      extra: { description: 'First paragraph.\n\nSecond paragraph.' },
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending');
  listingId = res.body.id;

  // Browsers send line breaks in forms as CRLF. They are stored as plain LF so paragraphs survive.
  const desc = app.db.prepare('SELECT description FROM listings WHERE id = ?').get(listingId).description;
  assert.equal(desc, 'First paragraph.\n\nSecond paragraph.');

  // Stored under a random name, outside anything that is served.
  const row = app.db.prepare("SELECT stored_path, sha256 FROM files WHERE kind = 'paid'").get();
  assert.ok(!row.stored_path.includes('full-pack'));
  assert.equal(row.sha256, crypto.createHash('sha256').update(paidBytes).digest('hex'));

  const browse = await makeClient(app.base).get('/api/listings');
  assert.equal(browse.body.total, 0, 'pending listings are not public');
  assert.equal((await makeClient(app.base).get(`/api/listings/${listingId}`)).status, 404);
  assert.equal((await buyer.get(`/api/listings/${listingId}`)).status, 404);
  assert.equal((await seller.get(`/api/listings/${listingId}`)).status, 200, 'the seller can see it');
  const mine = await seller.get('/api/me/listings');
  assert.equal(mine.body.listings[0].status, 'pending');
  imageId = (await seller.get(`/api/listings/${listingId}`)).body.listing.images[0];
  assert.equal((await makeClient(app.base).get(`/api/images/${imageId}`)).status, 404, 'pending images are private');
  assert.equal((await seller.get(`/api/images/${imageId}`)).status, 200);
});

test('admin reviews the queue', async () => {
  const q = await admin.get('/api/admin/queue');
  assert.equal(q.body.queue.length, 1);
  assert.equal(q.body.queue[0].paid_name, 'full-pack.zip');
  assert.equal(q.body.queue[0].features.length, 2);

  assert.equal((await seller.post(`/api/admin/listings/${listingId}/approve`, { json: {} })).status, 403, 'sellers cannot approve their own');
  assert.equal((await admin.post(`/api/admin/listings/${listingId}/reject`, { json: { reason: '' } })).status, 400);

  const rejected = await admin.post(`/api/admin/listings/${listingId}/reject`, { json: { reason: 'Add a clearer description.' } });
  assert.equal(rejected.status, 200);
  assert.equal((await seller.get('/api/me/listings')).body.listings[0].reject_reason, 'Add a clearer description.');

  // The seller edits it, which sends it back to review.
  const edit = await seller.patch(`/api/listings/${listingId}`, { json: { description: 'A clearer placeholder description.' } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.status, 'pending');
  assert.equal((await admin.post(`/api/admin/listings/${listingId}/approve`, { json: {} })).status, 200);
  assert.equal((await admin.post(`/api/admin/listings/${listingId}/approve`, { json: {} })).status, 409, 'already approved');
});

test('approved listings are public', async () => {
  const anon = makeClient(app.base);
  const browse = await anon.get('/api/listings?game=stardew-valley');
  assert.equal(browse.body.total, 1);
  assert.equal(browse.body.listings[0].price_pence, 1250);
  assert.equal((await anon.get('/api/listings?q=nothing-matches-this')).body.total, 0);
  assert.equal((await anon.get('/api/listings?q=%25')).body.total, 0, 'search treats % as plain text');
  assert.equal((await anon.get('/api/listings?game=hades')).body.total, 0);
  assert.equal((await anon.get('/api/listings?free=1')).body.total, 1, 'this listing has a free version');
  const detail = (await anon.get(`/api/listings/${listingId}`)).body.listing;
  assert.equal(detail.has_free, true);
  assert.equal(detail.category.id, 'save-tools');
  assert.equal(detail.game.slug, 'stardew-valley');
  assert.equal(detail.viewer.owned, false);
  assert.equal(detail.paid_file.name, 'full-pack.zip');
  assert.equal(detail.paid_file.path, undefined, 'no storage path leaks');
  assert.equal((await anon.get(`/api/images/${imageId}`)).status, 200);
  assert.equal((await anon.get('/api/stats')).body.listings, 1);
});

test('the free version downloads without paying, the full file does not', async () => {
  const anon = makeClient(app.base);
  const link = await anon.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'free' } });
  assert.equal(link.status, 200);
  const file = await anon.get(link.body.url);
  assert.equal(file.status, 200);
  assert.ok(file.body.equals(freeBytes));
  assert.match(file.headers.get('content-disposition'), /attachment; filename="free-pack.zip"/);
  assert.equal(file.headers.get('content-type'), 'application/octet-stream');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');

  assert.equal((await anon.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } })).status, 401);
  const noPay = await buyer.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } });
  assert.equal(noPay.status, 403);
});

test('buying: checkout, test payment, then download', async () => {
  assert.equal((await seller.post(`/api/listings/${listingId}/checkout`, { json: {} })).status, 400, 'cannot buy your own');
  assert.equal((await makeClient(app.base).post(`/api/listings/${listingId}/checkout`, { json: {} })).status, 401);

  const first = await buyer.post(`/api/listings/${listingId}/checkout`, { json: {} });
  assert.equal(first.status, 200);
  assert.equal(first.body.mock, true);
  const again = await buyer.post(`/api/listings/${listingId}/checkout`, { json: {} });
  assert.equal(again.body.order_id, first.body.order_id, 'the open order is reused');
  const orderId = first.body.order_id;

  const order = app.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.equal(order.amount_pence, 1250);
  assert.equal(order.fee_pence, 125);
  assert.equal(order.seller_net_pence, 1125);
  assert.equal(order.status, 'pending');

  assert.equal((await buyer.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } })).status, 403, 'not paid yet');
  assert.equal((await other.post(`/api/orders/${orderId}/mock-pay`, { json: {} })).status, 404, "cannot pay someone else's order");

  assert.equal((await buyer.post(`/api/orders/${orderId}/mock-pay`, { json: {} })).status, 200);
  assert.equal((await buyer.post(`/api/orders/${orderId}/mock-pay`, { json: {} })).status, 200, 'paying twice is harmless');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get().n, 1);
  assert.equal((await buyer.post(`/api/listings/${listingId}/checkout`, { json: {} })).status, 409, 'already owned');

  const link = await buyer.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } });
  assert.equal(link.status, 200);
  const file = await buyer.get(link.body.url);
  assert.equal(file.status, 200);
  assert.ok(file.body.equals(paidBytes), 'the buyer receives the exact uploaded bytes');

  // Other people cannot get it.
  assert.equal((await other.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } })).status, 403);
  assert.equal((await makeClient(app.base).get('/api/download/not-a-real-token')).status, 403);

  const purchases = await buyer.get('/api/me/orders');
  assert.equal(purchases.body.orders.length, 1);
  assert.equal(purchases.body.orders[0].can_download, true);
});

test('the seller sees the sale and the split', async () => {
  const sales = (await seller.get('/api/me/sales')).body;
  assert.deepEqual(sales.totals, { count: 1, gross_pence: 1250, fee_pence: 125, net_pence: 1125 });
  assert.equal(sales.sales[0].buyer, 'buyer_one');
  assert.equal((await seller.get('/api/me/listings')).body.listings[0].sales, 1);
});

test('the seller and admin can always download the full file', async () => {
  for (const who of [seller, admin]) {
    const link = await who.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } });
    assert.equal(link.status, 200);
    assert.ok((await who.get(link.body.url)).body.equals(paidBytes));
  }
  assert.ok(app.db.prepare('SELECT COUNT(*) AS n FROM download_log').get().n >= 4, 'downloads are logged');
});

test('removing a listing cuts off buyers too', async () => {
  assert.equal((await admin.post(`/api/admin/listings/${listingId}/remove`, { json: { reason: 'Breaks the seller rules.' } })).status, 200);
  assert.equal((await buyer.post(`/api/listings/${listingId}/download-link`, { json: { kind: 'paid' } })).status, 404);
  assert.equal((await makeClient(app.base).get('/api/listings')).body.total, 0);
  assert.equal((await buyer.get('/api/me/orders')).body.orders[0].can_download, false);
});

test('other sites cannot make a signed-in browser change things', async () => {
  const res = await seller.post(`/api/listings/${listingId}/withdraw`, { json: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal((await seller.post('/api/auth/logout', { json: {}, headers: { origin: app.base } })).status, 200);
});

test('writes must be JSON, and unknown routes 404', async () => {
  const c = makeClient(app.base);
  const res = await c.post('/api/auth/login', { headers: { 'content-type': 'text/plain' } });
  assert.equal(res.status, 415);
  assert.equal((await c.get('/api/nope')).status, 404);
  assert.equal((await c.get('/api/auth/login')).status, 405);
});

test('static files cannot escape the client folder', async () => {
  const home = await fetch(app.base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  const r = await fetch(app.base + '/..%2f..%2fetc%2fpasswd');
  assert.notEqual(r.status === 200 && (await r.text()).includes('root:'), true);
  const r2 = await fetch(app.base + '/%2e%2e/%2e%2e/etc/passwd');
  assert.notEqual(r2.status === 200 && (await r2.text()).includes('root:'), true);
});

test('stripe mode: webhook marks orders paid, once', async () => {
  const stripeApp = await startTestApp({ PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test' });
  try {
    const u = await signUp(stripeApp.base, 'buyer_two');
    const now = Date.now();
    const db = stripeApp.db;
    db.prepare("INSERT INTO files (id, owner_id, kind, orig_name, stored_path, size, sha256, created_at) VALUES ('f1', (SELECT id FROM users LIMIT 1), 'paid', 'a.zip', 'paid/f1', 1, 'x', ?)").run(now);
    const uid = db.prepare('SELECT id FROM users LIMIT 1').get().id;
    const gid = db.prepare('SELECT id FROM games LIMIT 1').get().id;
    db.prepare("INSERT INTO listings (id, seller_id, game_id, title, summary, description, price_pence, status, paid_file_id, created_at, updated_at) VALUES ('L1', ?, ?, 't', 's', 'd', 500, 'approved', 'f1', ?, ?)").run(uid, gid, now, now);
    const other = await signUp(stripeApp.base, 'seller_two');
    db.prepare("INSERT INTO orders (id, buyer_id, listing_id, amount_pence, fee_pence, seller_net_pence, status, provider, created_at) VALUES ('O1', ?, 'L1', 500, 50, 450, 'pending', 'stripe', ?)").run(uid, now);

    // A seller with no payout account cannot be bought from.
    const noPayout = await other.post('/api/listings/L1/checkout', { json: {} });
    assert.equal(noPayout.status, 409);

    // The test endpoint is off in stripe mode.
    assert.equal((await u.post('/api/orders/O1/mock-pay', { json: {} })).status, 404);

    const event = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: 'O1', payment_status: 'paid', payment_intent: 'pi_1' } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${event}`).digest('hex');
    const post = (header) => fetch(stripeApp.base + '/api/stripe/webhook', { method: 'POST', body: event, headers: { 'stripe-signature': header, 'content-type': 'application/json' } });

    assert.equal((await post(`t=${t},v1=deadbeef`)).status, 400, 'bad signature is refused');
    assert.equal(db.prepare("SELECT status FROM orders WHERE id = 'O1'").get().status, 'pending');
    assert.equal((await post(`t=${t},v1=${sig}`)).status, 200);
    assert.equal(db.prepare("SELECT status, provider_ref FROM orders WHERE id = 'O1'").get().provider_ref, 'pi_1');
    assert.equal(db.prepare("SELECT status FROM orders WHERE id = 'O1'").get().status, 'paid');
    assert.equal((await post(`t=${t},v1=${sig}`)).status, 200, 'a repeated event is ignored');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get().n, 1);
  } finally {
    await stripeApp.stop();
  }
});

test('production refuses unsafe settings', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /APP_SECRET/);
  const prod = { NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), BASE_URL: 'https://a.test' };
  assert.throws(() => loadConfig({ ...prod, APP_SECRET: 'change-me-to-a-long-random-string' }), /placeholder/);
  assert.throws(() => loadConfig({ ...prod, PAYMENTS: 'mock' }), /Test payments/);
  assert.throws(() => loadConfig({ ...prod, BASE_URL: 'http://a.test' }), /https/);
  assert.equal(loadConfig(prod).payments, 'off', 'payments are off unless a provider is set up');
  assert.doesNotThrow(() => loadConfig({ ...prod, STRIPE_SECRET_KEY: 'sk_live_x' }));
  assert.throws(() => loadConfig({ PAYMENTS: 'paypal' }), /PAYMENTS/);
});
