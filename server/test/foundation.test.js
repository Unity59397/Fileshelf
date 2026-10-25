import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, seedGames } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { MIGRATIONS, migrate } from '../src/migrations/index.js';
import * as baseline from '../src/migrations/001_baseline.js';
import { startTestApp, makeClient, signUp, signUpCreator, listingForm } from './helpers.js';

const bytes = crypto.randomBytes(4000);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fileshelf-mig-'));

// ---------------------------------------------------------------- migrations

test('a new database gets every migration, the categories and the starter games', () => {
  const dir = tempDir();
  const db = openDb(path.join(dir, 'new.db'));
  try {
    seedGames(db);
    const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id);
    assert.deepEqual(applied, MIGRATIONS.map((m) => m.id));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 6);
    const games = db.prepare('SELECT slug, steam_app_id, metadata_source FROM games ORDER BY slug').all();
    assert.equal(games.length, 8);
    assert.ok(games.every((g) => g.steam_app_id > 0 && g.metadata_source === 'manual'));
    assert.ok(!games.some((g) => /^game-/.test(g.slug)), 'no placeholder games');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.before-')), [], 'nothing to back up on a new database');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an older database is upgraded without losing anything', () => {
  const dir = tempDir();
  const file = path.join(dir, 'old.db');
  // Build the database the way the first version did: the baseline schema and no migrations table.
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON');
  baseline.up(old);
  const now = Date.now();
  old.prepare("INSERT INTO users (id, email, username, password_hash, role, created_at) VALUES ('u1','a@x.test','alice','h','admin',?)").run(now);
  old.prepare("INSERT INTO users (id, email, username, password_hash, role, created_at) VALUES ('u2','b@x.test','bob','h','user',?)").run(now);
  old.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t1','u1',?)").run(now + 100000);
  old.prepare("INSERT INTO games (id, slug, name, code, tint) VALUES ('g1','game-01','Game One','G01',1)").run();
  old.prepare("INSERT INTO games (id, slug, name, code, tint) VALUES ('g2','game-02','Game Two','G02',2)").run();
  old.prepare("INSERT INTO files (id, owner_id, kind, orig_name, stored_path, size, sha256, created_at) VALUES ('f1','u2','paid','a.zip','paid/f1',10,'x',?)").run(now);
  old.prepare(
    `INSERT INTO listings (id, seller_id, game_id, title, summary, description, price_pence, status, paid_file_id, created_at, updated_at)
     VALUES ('l1','u2','g1','Old listing','s','d',500,'approved','f1',?,?)`,
  ).run(now, now);
  old.prepare("INSERT INTO download_log (file_id, user_id, ip, created_at) VALUES ('f1','u1','1.2.3.4',?)").run(now);
  old.close();

  const db = openDb(file);
  try {
    seedGames(db);
    assert.deepEqual(
      db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id),
      MIGRATIONS.map((m) => m.id),
    );
    // Accounts, sessions, listings and files are all still there.
    assert.equal(db.prepare("SELECT role FROM users WHERE id = 'u1'").get().role, 'admin');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.equal(db.prepare("SELECT category_id, featured, is_demo FROM listings WHERE id = 'l1'").get().category_id, 'other');
    // Someone who already had a listing is now a creator with a profile.
    assert.equal(db.prepare("SELECT role FROM users WHERE id = 'u2'").get().role, 'creator');
    assert.equal(db.prepare("SELECT display_name FROM creator_profiles WHERE user_id = 'u2'").get().display_name, 'bob');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM creator_profiles WHERE user_id = 'u1'").get().n, 0, 'no listings, no profile');
    assert.equal(db.prepare("SELECT listing_id FROM download_log LIMIT 1").get().listing_id, 'l1', 'old downloads are matched to their listing');
    // New roles are now allowed, and bad ones still are not.
    db.prepare("UPDATE users SET role = 'moderator' WHERE id = 'u2'").run();
    assert.throws(() => db.prepare("UPDATE users SET role = 'owner' WHERE id = 'u2'").run());
    // The unused placeholder game went, the used one stayed, and the starter games were not added on top of it.
    const slugs = db.prepare('SELECT slug FROM games ORDER BY slug').all().map((g) => g.slug);
    assert.deepEqual(slugs, ['game-01']);
    // Foreign keys still hold after the users table was rebuilt.
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.throws(() => db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t2','nobody',1)").run());
    // A copy was saved before the structure changed.
    assert.ok(fs.existsSync(`${file}.before-002_foundation`));
  } finally {
    db.close();
  }

  // Opening it again changes nothing.
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, MIGRATIONS.length);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a migration that fails is rolled back completely', () => {
  const dir = tempDir();
  const db = openDb(path.join(dir, 'fail.db'));
  const bad = {
    id: '999_bad',
    up(d) {
      d.exec('CREATE TABLE half_done (x INTEGER)');
      throw new Error('boom');
    },
  };
  MIGRATIONS.push(bad);
  try {
    assert.throws(() => migrate(db, path.join(dir, 'fail.db')), /boom/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get(), undefined);
    assert.equal(db.prepare("SELECT id FROM schema_migrations WHERE id = '999_bad'").get(), undefined);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys are switched back on');
  } finally {
    MIGRATIONS.pop();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the audit log cannot be edited or deleted', async () => {
  const app = await startTestApp();
  try {
    app.db.prepare("INSERT INTO audit_log (actor_name, action, created_at) VALUES ('x','test',1)").run();
    assert.throws(() => app.db.prepare("UPDATE audit_log SET action = 'changed'").run(), /cannot be changed/);
    assert.throws(() => app.db.prepare('DELETE FROM audit_log').run(), /cannot be changed/);
  } finally {
    await app.stop();
  }
});

// ---------------------------------------------------------------- roles

async function setup() {
  const app = await startTestApp();
  const people = {
    admin: await signUp(app.base, 'admin_user', 'admin@fileshelf.test'),
    creator: await signUpCreator(app.base, 'creator_one'),
    creator2: await signUpCreator(app.base, 'creator_two'),
    member: await signUp(app.base, 'member_one'),
    mod: await signUp(app.base, 'mod_one'),
    anon: makeClient(app.base),
  };
  const modId = app.db.prepare("SELECT id FROM users WHERE username = 'mod_one'").get().id;
  assert.equal((await people.admin.post(`/api/admin/users/${modId}/role`, { json: { role: 'moderator' } })).status, 200);
  return { app, ...people, modId };
}

async function submit(who, opts = {}) {
  const res = await who.post('/api/listings', {
    form: listingForm({ file: { name: 'tool.zip', data: bytes }, price: '', ...opts }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

test('each role can do exactly what it should', async () => {
  const t = await setup();
  try {
    const id = await submit(t.creator);

    // Who can see the review queue.
    assert.equal((await t.anon.get('/api/admin/queue')).status, 401);
    assert.equal((await t.member.get('/api/admin/queue')).status, 403);
    assert.equal((await t.creator.get('/api/admin/queue')).status, 403, 'creators cannot review');
    assert.equal((await t.mod.get('/api/admin/queue')).status, 200);
    assert.equal((await t.admin.get('/api/admin/queue')).status, 200);

    // Who can act on it.
    for (const who of [t.anon, t.member, t.creator, t.creator2]) {
      const res = await who.post(`/api/admin/listings/${id}/approve`, { json: {} });
      assert.ok([401, 403].includes(res.status), `status ${res.status}`);
    }
    assert.equal(t.app.db.prepare('SELECT status FROM listings WHERE id = ?').get(id).status, 'pending');

    // Admin-only areas, which a moderator cannot reach.
    for (const [method, url, json] of [
      ['get', '/api/admin/users'],
      ['get', '/api/admin/audit'],
      ['post', `/api/admin/users/${t.modId}/role`, { role: 'user' }],
      ['post', `/api/admin/listings/${id}/feature`, { featured: true }],
      ['post', '/api/admin/games', { name: 'Some Game' }],
      ['patch', '/api/admin/games/hades', { developer: 'x' }],
    ]) {
      const res = await t.mod[method](url, json ? { json } : {});
      assert.equal(res.status, 403, `${method} ${url} should be admin only`);
    }

    assert.equal((await t.mod.post(`/api/admin/listings/${id}/approve`, { json: {} })).status, 200);
  } finally {
    await t.app.stop();
  }
});

test('a moderator cannot approve their own listing', async () => {
  const t = await setup();
  try {
    // Moderators can publish too.
    const id = await submit(t.mod);
    const own = await t.mod.post(`/api/admin/listings/${id}/approve`, { json: {} });
    assert.equal(own.status, 403);
    assert.equal(t.app.db.prepare('SELECT status FROM listings WHERE id = ?').get(id).status, 'pending');
    assert.equal((await t.admin.post(`/api/admin/listings/${id}/approve`, { json: {} })).status, 200);
  } finally {
    await t.app.stop();
  }
});

test('moderation actions are written to the audit log', async () => {
  const t = await setup();
  try {
    const a = await submit(t.creator);
    const b = await submit(t.creator, { title: 'Second tool' });
    assert.equal((await t.mod.post(`/api/admin/listings/${a}/approve`, { json: {} })).status, 200);
    assert.equal((await t.mod.post(`/api/admin/listings/${b}/reject`, { json: { reason: 'Needs a clearer description.' } })).status, 200);
    assert.equal((await t.mod.post(`/api/admin/listings/${a}/remove`, { json: { reason: 'Broke the rules.' } })).status, 200);
    assert.equal((await t.admin.post(`/api/admin/games`, { json: { name: 'Another Game' } })).status, 201);

    const log = (await t.admin.get('/api/admin/audit')).body;
    const actions = log.entries.map((e) => e.action);
    for (const expected of ['bootstrap_admin', 'role_change', 'creator_signup', 'listing_approve', 'listing_reject', 'listing_remove', 'game_create']) {
      assert.ok(actions.includes(expected), `missing ${expected}: ${actions.join(', ')}`);
    }
    const reject = log.entries.find((e) => e.action === 'listing_reject');
    assert.equal(reject.actor_name, 'mod_one');
    assert.equal(reject.target_id, b);
    assert.equal(reject.detail.reason, 'Needs a clearer description.');
    // Newest first.
    assert.ok(log.entries[0].id > log.entries[log.entries.length - 1].id);
  } finally {
    await t.app.stop();
  }
});

test('failed moderation actions leave no audit entry', async () => {
  const t = await setup();
  try {
    const before = t.app.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    const id = await submit(t.creator);
    assert.equal((await t.mod.post(`/api/admin/listings/${id}/reject`, { json: { reason: '' } })).status, 400);
    assert.equal((await t.mod.post('/api/admin/listings/missing/approve', { json: {} })).status, 409);
    assert.equal(t.app.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, before, 'rejected actions are not recorded');
  } finally {
    await t.app.stop();
  }
});

test('admins change roles, and the change applies straight away', async () => {
  const t = await setup();
  try {
    const memberId = t.app.db.prepare("SELECT id FROM users WHERE username = 'member_one'").get().id;
    const adminId = t.app.db.prepare("SELECT id FROM users WHERE username = 'admin_user'").get().id;

    assert.equal((await t.member.get('/api/admin/queue')).status, 403);
    assert.equal((await t.admin.post(`/api/admin/users/${memberId}/role`, { json: { role: 'moderator' } })).status, 200);
    assert.equal((await t.member.get('/api/admin/queue')).status, 200, 'no sign-out needed');
    assert.equal((await t.member.get('/api/auth/me')).body.user.is_moderator, true);
    assert.equal(t.app.db.prepare('SELECT COUNT(*) AS n FROM creator_profiles WHERE user_id = ?').get(memberId).n, 1, 'staff get a profile');

    assert.equal((await t.admin.post(`/api/admin/users/${memberId}/role`, { json: { role: 'user' } })).status, 200);
    assert.equal((await t.member.get('/api/admin/queue')).status, 403, 'demoted straight away');

    assert.equal((await t.admin.post(`/api/admin/users/${adminId}/role`, { json: { role: 'user' } })).status, 400, 'not your own role');
    assert.equal((await t.admin.post(`/api/admin/users/${memberId}/role`, { json: { role: 'owner' } })).status, 400);
    assert.equal((await t.admin.post('/api/admin/users/nobody/role', { json: { role: 'user' } })).status, 404);

    const change = (await t.admin.get('/api/admin/audit')).body.entries.find((e) => e.action === 'role_change' && e.detail.to === 'user');
    assert.deepEqual([change.detail.from, change.detail.to, change.detail.username], ['moderator', 'user', 'member_one']);

    const users = (await t.admin.get('/api/admin/users?q=member')).body.users;
    assert.deepEqual(users.map((u) => u.username), ['member_one']);
    assert.equal(users[0].password_hash, undefined);
  } finally {
    await t.app.stop();
  }
});

test('ADMIN_EMAIL only makes the first admin', async () => {
  const app = await startTestApp();
  try {
    // An admin already exists (made some other way), so signing up with the admin email gives no special rights.
    app.db
      .prepare("INSERT INTO users (id, email, username, password_hash, role, created_at) VALUES ('root','root@x.test','root','h','admin',?)")
      .run(Date.now());
    const late = await signUp(app.base, 'latecomer', 'admin@fileshelf.test');
    assert.equal((await late.get('/api/auth/me')).body.user.role, 'user');
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bootstrap_admin'").get().n, 0);
  } finally {
    await app.stop();
  }

  const fresh = await startTestApp();
  try {
    const first = await signUp(fresh.base, 'first_admin', 'admin@fileshelf.test');
    assert.equal((await first.get('/api/auth/me')).body.user.role, 'admin');
    assert.equal(fresh.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bootstrap_admin'").get().n, 1);
  } finally {
    await fresh.stop();
  }
});

test('becoming a creator', async () => {
  const t = await setup();
  try {
    const anon = await t.anon.post('/api/me/creator', { json: { display_name: 'Nobody' } });
    assert.equal(anon.status, 401);
    for (const body of [{ display_name: 'x' }, { display_name: '<b>bold</b>' }, { display_name: 'Fine', bio: 'y'.repeat(501) }]) {
      assert.equal((await t.member.post('/api/me/creator', { json: body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await t.member.get('/api/me/creator')).body.profile, null);
    const res = await t.member.post('/api/me/creator', { json: { display_name: 'Member One', bio: 'I make small tools.' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'creator');
    assert.equal((await t.member.get('/api/auth/me')).body.user.can_publish, true);

    // Updating the profile keeps the role. A moderator stays a moderator.
    assert.equal((await t.mod.post('/api/me/creator', { json: { display_name: 'The Mod', bio: '' } })).body.role, 'moderator');
    assert.equal(t.app.db.prepare("SELECT role FROM users WHERE username = 'mod_one'").get().role, 'moderator');
  } finally {
    await t.app.stop();
  }
});

test('creators can only change their own listings', async () => {
  const t = await setup();
  try {
    const id = await submit(t.creator);
    assert.equal((await t.creator2.patch(`/api/listings/${id}`, { json: { title: 'Hijacked title' } })).status, 404);
    assert.equal((await t.creator2.post(`/api/listings/${id}/withdraw`, { json: {} })).status, 404);
    assert.equal((await t.member.patch(`/api/listings/${id}`, { json: { title: 'Hijacked title' } })).status, 404);
    assert.equal((await t.creator2.get(`/api/listings/${id}`)).status, 404, 'other creators cannot see it before approval');
    assert.equal((await t.mod.get(`/api/listings/${id}`)).status, 200, 'moderators can');
    assert.equal(t.app.db.prepare('SELECT title FROM listings WHERE id = ?').get(id).title, 'Save backup helper');
  } finally {
    await t.app.stop();
  }
});

test('odd addresses and cookies do not crash the server', async () => {
  const app = await startTestApp();
  try {
    assert.equal((await fetch(`${app.base}/api/listings/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`${app.base}/%E0%A4%A`)).status, 404);
    const res = await fetch(`${app.base}/api/auth/me`, { headers: { cookie: 'fs_session=%E0%A4%A' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user, null);
    // The server is still answering.
    assert.equal((await fetch(`${app.base}/api/categories`)).status, 200);
  } finally {
    await app.stop();
  }
});

test('demo accounts from the seed script cannot sign in on a production site', async () => {
  const hash = await hashPassword('placeholder-password');
  const insert = (app, email, name, demo) =>
    app.db
      .prepare("INSERT INTO users (id, email, username, password_hash, role, is_demo, created_at) VALUES (?,?,?,?,'admin',?,?)")
      .run(crypto.randomUUID(), email, name, hash, demo, Date.now());
  const login = (app, email) => makeClient(app.base).post('/api/auth/login', { json: { email, password: 'placeholder-password' } });
  const prod = { NODE_ENV: 'production', BASE_URL: 'https://shelf.test', PAYMENTS: 'off', APP_SECRET: 'p'.repeat(40) };

  const live = await startTestApp(prod);
  try {
    insert(live, 'demo@fileshelf.test', 'demo_admin', 1);
    insert(live, 'real@fileshelf.test', 'real_admin', 0);
    assert.equal((await login(live, 'demo@fileshelf.test')).status, 401, 'demo account refused in production');
    assert.equal((await login(live, 'real@fileshelf.test')).status, 200, 'a real account still works');
  } finally {
    await live.stop();
  }

  const dev = await startTestApp();
  try {
    insert(dev, 'demo@fileshelf.test', 'demo_admin', 1);
    assert.equal((await login(dev, 'demo@fileshelf.test')).status, 200, 'demo account works in development');
  } finally {
    await dev.stop();
  }
});
