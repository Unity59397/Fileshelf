import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestApp, makeClient, signUp, signUpCreator, listingForm } from './helpers.js';

const bytes = crypto.randomBytes(6000);

async function setup(env = { PAYMENTS: 'off' }) {
  const app = await startTestApp(env);
  const t = {
    app,
    admin: await signUp(app.base, 'admin_user', 'admin@fileshelf.test'),
    creator: await signUpCreator(app.base, 'creator_one'),
    member: await signUp(app.base, 'member_one'),
    member2: await signUp(app.base, 'member_two'),
    anon: makeClient(app.base),
  };
  return t;
}

async function publish(t, opts = {}) {
  const res = await t.creator.post('/api/listings', {
    form: listingForm({ file: { name: 'tool.zip', data: bytes }, price: '', ...opts }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await t.admin.post(`/api/admin/listings/${res.body.id}/approve`, { json: {} })).status, 200);
  return res.body.id;
}

const download = async (who, id, kind = 'paid') => {
  const link = await who.post(`/api/listings/${id}/download-link`, { json: { kind } });
  if (link.status !== 200) return { status: link.status };
  const file = await who.get(link.body.url);
  return { status: file.status, body: file.body };
};

// ---------------------------------------------------------------- free listings

test('with payments off, listings are free and signed-in users can download them', async () => {
  const t = await setup();
  try {
    const config = (await t.anon.get('/api/config')).body;
    assert.equal(config.payments, 'off');
    assert.equal(config.demo_data, false);

    const paid = await t.creator.post('/api/listings', { form: listingForm({ file: { name: 'a.zip', data: bytes }, price: '5.00' }) });
    assert.equal(paid.status, 400);
    assert.match(paid.body.error, /not available yet/);
    const both = await t.creator.post('/api/listings', {
      form: listingForm({ file: { name: 'a.zip', data: bytes }, free: { name: 'b.zip', data: bytes }, price: '' }),
    });
    assert.equal(both.status, 400, 'a free listing has no separate free version');

    const pending = await t.creator.post('/api/listings', { form: listingForm({ file: { name: 'a.zip', data: bytes }, price: '' }) });
    assert.equal(pending.status, 201);
    assert.equal((await download(t.member, pending.body.id)).status, 404, 'not downloadable before approval');
    assert.equal((await download(t.creator, pending.body.id)).status, 200, 'the creator can check their own file');

    assert.equal((await t.admin.post(`/api/admin/listings/${pending.body.id}/approve`, { json: {} })).status, 200);
    const id = pending.body.id;
    const card = (await t.anon.get('/api/listings')).body.listings[0];
    assert.equal(card.is_free, true);
    assert.equal(card.price_pence, 0);
    assert.equal((await t.anon.get('/api/listings?free=1')).body.total, 1);

    assert.equal((await download(t.anon, id)).status, 401, 'guests must sign in');
    const got = await download(t.member, id);
    assert.equal(got.status, 200);
    assert.ok(got.body.equals(bytes));

    const log = t.app.db.prepare('SELECT listing_id, user_id FROM download_log').all();
    assert.equal(log.length, 2);
    assert.ok(log.every((r) => r.listing_id === id && r.user_id), 'downloads record the listing and the person');

    assert.equal((await t.member.post(`/api/listings/${id}/checkout`, { json: {} })).status, 404, 'no checkout while payments are off');
    assert.equal((await t.creator.post('/api/me/payouts/connect', { json: {} })).status, 404);
    assert.equal((await t.member.post(`/api/orders/x/mock-pay`, { json: {} })).status, 404);
  } finally {
    await t.app.stop();
  }
});

test('a download link stops working if the listing is removed after it was made', async () => {
  const t = await setup();
  try {
    const id = await publish(t);
    const link = await t.member.post(`/api/listings/${id}/download-link`, { json: { kind: 'paid' } });
    const sellerLink = await t.creator.post(`/api/listings/${id}/download-link`, { json: { kind: 'paid' } });
    assert.equal((await t.admin.post(`/api/admin/listings/${id}/remove`, { json: { reason: 'Broke the rules.' } })).status, 200);
    assert.equal((await t.member.get(link.body.url)).status, 404);
    assert.equal((await t.creator.get(sellerLink.body.url)).status, 200, 'the creator can still reach their own file');
  } finally {
    await t.app.stop();
  }
});

// ---------------------------------------------------------------- categories, filters, featured

test('categories and filters', async () => {
  const t = await setup();
  try {
    const cats = (await t.anon.get('/api/categories')).body.categories;
    assert.equal(cats.length, 6);
    assert.deepEqual(cats.map((c) => c.id), ['trainers', 'save-tools', 'mods', 'configs', 'utilities', 'other']);
    assert.ok(cats.every((c) => c.listings === 0));

    const a = await publish(t, { title: 'Save backup helper', game: 'stardew-valley', category: 'save-tools' });
    const b = await publish(t, { title: 'Texture pack', game: 'skyrim-special-edition', category: 'mods' });

    const list = async (qs) => (await t.anon.get(`/api/listings${qs}`)).body;
    assert.equal((await list('?category=save-tools')).total, 1);
    assert.equal((await list('?category=save-tools')).listings[0].id, a);
    assert.equal((await list('?category=mods')).listings[0].category.name, 'Mods and mod packs');
    assert.equal((await list('?category=trainers')).total, 0);
    assert.equal((await list('?category=mods&game=stardew-valley')).total, 0, 'filters combine');
    assert.equal((await list('?q=skyrim')).total, 1, 'search also matches the game name');
    assert.equal((await list('?q=texture')).listings[0].id, b);
    assert.equal((await list('?sort=updated')).total, 2);
    assert.equal((await t.anon.get('/api/categories')).body.categories.find((c) => c.id === 'mods').listings, 1);

    // Featured listings are chosen by an admin.
    assert.equal((await t.anon.get('/api/listings?featured=1')).body.total, 0);
    assert.equal((await t.creator.post(`/api/admin/listings/${a}/feature`, { json: { featured: true } })).status, 403);
    assert.equal((await t.admin.post(`/api/admin/listings/${a}/feature`, { json: { featured: true } })).status, 200);
    assert.deepEqual((await list('?featured=1')).listings.map((l) => l.id), [a]);
    assert.equal((await list('?featured=1')).listings[0].featured, true);

    // Editing a listing sends it back to review, which also takes it off the featured list.
    assert.equal((await t.creator.patch(`/api/listings/${a}`, { json: { category: 'utilities' } })).status, 200);
    assert.equal((await t.creator.patch(`/api/listings/${a}`, { json: { category: 'nope' } })).status, 400);
    assert.equal((await list('?featured=1')).total, 0);
    assert.equal((await t.admin.post(`/api/admin/listings/${a}/feature`, { json: { featured: true } })).status, 409, 'only live listings');
  } finally {
    await t.app.stop();
  }
});

// ---------------------------------------------------------------- games and Intel

test('games directory and game pages', async () => {
  const t = await setup();
  try {
    const all = (await t.anon.get('/api/games')).body.games;
    assert.equal(all.length, 8);
    assert.deepEqual(all.map((g) => g.name), [...all.map((g) => g.name)].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })));
    assert.ok(all.every((g) => g.steam_app_id && g.developer && g.release_date));

    const find = async (q) => (await t.anon.get(`/api/games?q=${encodeURIComponent(q)}`)).body.games.map((g) => g.slug);
    assert.deepEqual(await find('elden'), ['elden-ring']);
    assert.deepEqual(await find('1245620'), ['elden-ring'], 'search by Steam App ID');
    assert.deepEqual((await find('bethesda')).sort(), ['fallout-4', 'skyrim-special-edition']);
    assert.deepEqual(await find('%'), []);
    assert.deepEqual(await find('no such game'), []);

    const byDate = (await t.anon.get('/api/games?sort=released')).body.games;
    assert.equal(byDate[0].slug, 'baldurs-gate-3');
    assert.equal(byDate.at(-1).slug, 'the-witcher-3');

    await publish(t, { game: 'hades' });
    const byListings = (await t.anon.get('/api/games?sort=listings')).body.games;
    assert.equal(byListings[0].slug, 'hades');
    assert.equal(byListings[0].listings, 1);

    const page = (await t.anon.get('/api/games/hades')).body;
    assert.equal(page.game.name, 'Hades');
    assert.equal(page.game.store_url, 'https://store.steampowered.com/app/1145360/');
    assert.equal(page.game.metadata_source, 'manual');
    assert.ok(page.game.description.length > 20);
    // No provider is set up, so there is no player count and the response says so.
    assert.deepEqual(page.players, { status: 'not_configured', current: null, updated_at: null });
    assert.equal((await t.anon.get('/api/games/not-a-game')).status, 404);
  } finally {
    await t.app.stop();
  }
});

test('admins can add games and correct their details', async () => {
  const t = await setup();
  try {
    const add = (json, who = t.admin) => who.post('/api/admin/games', { json });
    const ok = await add({ name: 'Balatro', steam_app_id: '2379780', developer: 'LocalThunk', release_date: '2024-02-20', official_url: 'https://www.playbalatro.com/' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const page = (await t.anon.get('/api/games/balatro')).body.game;
    assert.equal(page.steam_app_id, 2379780);
    assert.equal(page.official_url, 'https://www.playbalatro.com/');

    assert.equal((await add({ name: 'Balatro' })).status, 409, 'same name');
    assert.equal((await add({ name: 'Another', steam_app_id: '2379780' })).status, 409, 'same Steam App ID');
    assert.equal((await add({ name: 'Bad Date', release_date: '20 Feb 2024' })).status, 400);
    assert.equal((await add({ name: 'Bad Link', official_url: 'http://example.test' })).status, 400);
    assert.equal((await add({ name: 'Bad Id', steam_app_id: 'abc' })).status, 400);
    assert.equal((await add({ name: 'Not Allowed' }, t.creator)).status, 403);

    const patch = (slug, json) => t.admin.patch(`/api/admin/games/${slug}`, { json });
    assert.equal((await patch('hades', { developer: 'Supergiant Games Inc.' })).status, 200);
    assert.equal((await t.anon.get('/api/games/hades')).body.game.developer, 'Supergiant Games Inc.');
    assert.equal((await patch('hades', { steam_app_id: '413150' })).status, 409, 'that ID belongs to Stardew Valley');
    assert.equal((await patch('hades', {})).status, 400);
    assert.equal((await patch('nope', { developer: 'x' })).status, 404);

    const actions = t.app.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'game_%'").all().map((r) => r.action);
    assert.deepEqual(actions.sort(), ['game_create', 'game_update']);
  } finally {
    await t.app.stop();
  }
});

// ---------------------------------------------------------------- Vault

test('the Vault keeps a private list of saved listings and downloads', async () => {
  const t = await setup();
  try {
    const id = await publish(t);
    const pendingRes = await t.creator.post('/api/listings', { form: listingForm({ file: { name: 'a.zip', data: bytes }, price: '' }) });

    assert.equal((await t.anon.get('/api/me/vault')).status, 401);
    assert.equal((await t.anon.post(`/api/me/vault/${id}`, { json: {} })).status, 401);
    assert.equal((await t.anon.get('/api/me/downloads')).status, 401);
    assert.equal((await t.member.post(`/api/me/vault/${pendingRes.body.id}`, { json: {} })).status, 404, 'only live listings can be saved');
    assert.equal((await t.member.post('/api/me/vault/missing', { json: {} })).status, 404);

    assert.equal((await t.member.post(`/api/me/vault/${id}`, { json: {} })).status, 200);
    assert.equal((await t.member.post(`/api/me/vault/${id}`, { json: {} })).status, 200, 'saving twice is harmless');
    assert.equal(t.app.db.prepare('SELECT COUNT(*) AS n FROM saved_listings').get().n, 1);
    assert.equal((await t.member.get(`/api/listings/${id}`)).body.listing.viewer.saved, true);
    assert.equal((await t.member2.get(`/api/listings/${id}`)).body.listing.viewer.saved, false);
    assert.equal((await t.anon.get(`/api/listings/${id}`)).body.listing.viewer.saved, false);

    const vault = (await t.member.get('/api/me/vault')).body.saved;
    assert.equal(vault.length, 1);
    assert.equal(vault[0].id, id);
    assert.equal(vault[0].available, true);
    assert.equal(vault[0].can_download, true);
    assert.equal(vault[0].last_downloaded_at, null, 'nothing downloaded yet');
    assert.deepEqual((await t.member2.get('/api/me/vault')).body.saved, [], 'other people see their own list');

    // Downloads are recorded for the person who made them, and only they see them.
    assert.equal((await download(t.member, id)).status, 200);
    const history = (await t.member.get('/api/me/downloads')).body.downloads;
    assert.equal(history.length, 1);
    assert.equal(history[0].listing_id, id);
    assert.equal(history[0].title, 'Save backup helper');
    assert.equal(history[0].file_name, 'tool.zip');
    assert.equal(history[0].version, '1.0');
    assert.deepEqual((await t.member2.get('/api/me/downloads')).body.downloads, []);
    assert.ok((await t.member.get('/api/me/vault')).body.saved[0].last_downloaded_at > 0);

    // A removed listing stays in the Vault so the person knows what happened, but cannot be downloaded.
    assert.equal((await t.admin.post(`/api/admin/listings/${id}/remove`, { json: { reason: 'Broke the rules.' } })).status, 200);
    const after = (await t.member.get('/api/me/vault')).body.saved[0];
    assert.equal(after.available, false);
    assert.equal(after.can_download, false);
    assert.equal((await t.member.get('/api/me/downloads')).body.downloads[0].listing_status, 'removed');
  } finally {
    await t.app.stop();
  }
});

test('saved listings can be removed from the Vault', async () => {
  const t = await setup();
  try {
    const id = await publish(t);
    await t.member.post(`/api/me/vault/${id}`, { json: {} });
    assert.equal((await t.member.delete(`/api/me/vault/${id}`)).status, 200);
    assert.equal((await t.member2.delete(`/api/me/vault/${id}`)).status, 200, 'deleting what you never saved is harmless');
    assert.deepEqual((await t.member.get('/api/me/vault')).body.saved, []);
  } finally {
    await t.app.stop();
  }
});

// ---------------------------------------------------------------- creators

test('the creators directory and profile pages', async () => {
  const t = await setup();
  try {
    // A creator with only a pending listing is not listed yet.
    await t.creator.post('/api/listings', { form: listingForm({ file: { name: 'a.zip', data: bytes }, price: '' }) });
    assert.deepEqual((await t.anon.get('/api/creators')).body.creators, []);

    const profile = await t.creator.post('/api/me/creator', { json: { display_name: 'Creator One', bio: 'I make save tools.' } });
    assert.equal(profile.status, 200);
    const id = await publish(t, { title: 'Live tool' });

    const list = (await t.anon.get('/api/creators')).body.creators;
    assert.equal(list.length, 1);
    assert.equal(list[0].username, 'creator_one');
    assert.equal(list[0].display_name, 'Creator One');
    assert.equal(list[0].listings, 1, 'pending listings are not counted');
    assert.equal(list[0].email, undefined);

    const page = (await t.anon.get('/api/creators/creator_one')).body;
    assert.equal(page.creator.bio, 'I make save tools.');
    assert.deepEqual(page.listings.map((l) => l.id), [id], 'only live listings are shown');
    assert.equal(page.listings[0].seller_display, 'Creator One');
    assert.equal(JSON.stringify(page).includes('@example.test'), false, 'no email addresses are exposed');
    assert.equal((await t.anon.get('/api/creators/nobody')).status, 404);
    assert.equal((await t.anon.get('/api/creators/member_one')).status, 404, 'plain accounts have no profile page');
  } finally {
    await t.app.stop();
  }
});

// ---------------------------------------------------------------- paid listings in test mode

test('in test-payment mode the Vault only offers purchased paid listings', async () => {
  const t = await setup({ PAYMENTS: 'mock' });
  try {
    const id = await publish(t, { price: '4.00' });
    await t.member.post(`/api/me/vault/${id}`, { json: {} });
    assert.equal((await t.member.get('/api/me/vault')).body.saved[0].can_download, false);
    assert.equal((await download(t.member, id)).status, 403);
    const order = (await t.member.post(`/api/listings/${id}/checkout`, { json: {} })).body.order_id;
    assert.equal((await t.member.post(`/api/orders/${order}/mock-pay`, { json: {} })).status, 200);
    assert.equal((await t.member.get('/api/me/vault')).body.saved[0].can_download, true);
    assert.equal((await download(t.member, id)).status, 200);
    const free = await publish(t, { title: 'Free one' });
    assert.equal((await t.member.post(`/api/listings/${free}/checkout`, { json: {} })).status, 400, 'free listings have no checkout');
  } finally {
    await t.app.stop();
  }
});
