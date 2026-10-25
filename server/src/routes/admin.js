import crypto from 'node:crypto';
import { httpError } from '../http.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { ROLES } from '../auth.js';
import { ensureProfile } from '../profiles.js';

function reasonFrom(body) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw httpError(400, 'Give a reason of 3 to 500 characters.');
  return reason;
}

// Optional game fields shared by "add a game" and "edit a game".
function readGameDetails(body) {
  const out = {};
  const str = (key, max) => {
    if (body[key] === undefined) return;
    const v = String(body[key] ?? '').replace(/\r\n?/g, '\n').trim();
    if (v.length > max) throw httpError(400, `${key.replace('_', ' ')} must be ${max} characters or fewer.`);
    out[key] = v || null;
  };
  str('developer', 80);
  str('publisher', 80);
  str('genres', 100);
  str('description', 600);
  if (body.release_date !== undefined) {
    const v = String(body.release_date ?? '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw httpError(400, 'Enter the release date as YYYY-MM-DD.');
    out.release_date = v || null;
  }
  if (body.steam_app_id !== undefined) {
    const v = String(body.steam_app_id ?? '').trim();
    if (v && !/^\d{1,10}$/.test(v)) throw httpError(400, 'The Steam App ID is a whole number.');
    out.steam_app_id = v ? Number(v) : null;
  }
  if (body.official_url !== undefined) {
    const v = String(body.official_url ?? '').trim();
    if (v && !/^https:\/\/[^\s]{3,300}$/.test(v)) throw httpError(400, 'The official link must start with https://');
    out.official_url = v || null;
  }
  return out;
}

export function register(r) {
  // ---- Moderation: moderators and admins ----
  r.get('/api/admin/queue', (c) => {
    c.requireModerator();
    const rows = c.db
      .prepare(
        `SELECT l.id, l.title, l.summary, l.description, l.features, l.price_pence, l.version, l.created_at,
                g.name AS game_name, cat.name AS category_name, u.username AS seller, u.email AS seller_email,
                pf.orig_name AS paid_name, pf.size AS paid_size, pf.sha256 AS paid_sha256, pf.scan_status AS paid_scan,
                ff.orig_name AS free_name, ff.size AS free_size,
                (SELECT COUNT(*) FROM listing_images li WHERE li.listing_id = l.id) AS image_count
         FROM listings l
         JOIN games g ON g.id = l.game_id
         JOIN users u ON u.id = l.seller_id
         JOIN files pf ON pf.id = l.paid_file_id
         LEFT JOIN files ff ON ff.id = l.free_file_id
         LEFT JOIN categories cat ON cat.id = l.category_id
         WHERE l.status = 'pending'
         ORDER BY l.created_at ASC`,
      )
      .all();
    c.json(200, { queue: rows.map((x) => ({ ...x, features: JSON.parse(x.features) })) });
  });

  r.post('/api/admin/listings/:id/approve', (c) => {
    const actor = c.requireModerator();
    tx(c.db, () => {
      const row = c.db.prepare("SELECT title, seller_id FROM listings WHERE id = ? AND status = 'pending'").get(c.params.id);
      if (!row) throw httpError(409, 'Only listings waiting for review can be approved.');
      if (row.seller_id === actor.id && actor.role !== 'admin') {
        throw httpError(403, 'You cannot approve your own listing. Ask another moderator.');
      }
      c.db
        .prepare("UPDATE listings SET status = 'approved', reject_reason = NULL, updated_at = ? WHERE id = ?")
        .run(Date.now(), c.params.id);
      audit(c.db, actor, 'listing_approve', 'listing', c.params.id, { title: row.title });
    });
    c.json(200, { id: c.params.id, status: 'approved' });
  });

  r.post('/api/admin/listings/:id/reject', async (c) => {
    const actor = c.requireModerator();
    const reason = reasonFrom(await c.readJson());
    tx(c.db, () => {
      const row = c.db.prepare("SELECT title FROM listings WHERE id = ? AND status = 'pending'").get(c.params.id);
      if (!row) throw httpError(409, 'Only listings waiting for review can be rejected.');
      c.db
        .prepare("UPDATE listings SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?")
        .run(reason, Date.now(), c.params.id);
      audit(c.db, actor, 'listing_reject', 'listing', c.params.id, { title: row.title, reason });
    });
    c.json(200, { id: c.params.id, status: 'rejected' });
  });

  // Takes a live listing down. People lose access to the file too.
  r.post('/api/admin/listings/:id/remove', async (c) => {
    const actor = c.requireModerator();
    const reason = reasonFrom(await c.readJson());
    tx(c.db, () => {
      const row = c.db.prepare("SELECT title FROM listings WHERE id = ? AND status != 'removed'").get(c.params.id);
      if (!row) throw httpError(404, 'Listing not found.');
      c.db
        .prepare("UPDATE listings SET status = 'removed', featured = 0, reject_reason = ?, updated_at = ? WHERE id = ?")
        .run(reason, Date.now(), c.params.id);
      audit(c.db, actor, 'listing_remove', 'listing', c.params.id, { title: row.title, reason });
    });
    c.json(200, { id: c.params.id, status: 'removed' });
  });

  // ---- Administration: admins only ----
  r.post('/api/admin/listings/:id/feature', async (c) => {
    const actor = c.requireAdmin();
    const body = await c.readJson();
    const featured = body.featured === true ? 1 : 0;
    tx(c.db, () => {
      const row = c.db.prepare("SELECT title FROM listings WHERE id = ? AND status = 'approved'").get(c.params.id);
      if (!row) throw httpError(409, 'Only live listings can be featured.');
      c.db.prepare('UPDATE listings SET featured = ? WHERE id = ?').run(featured, c.params.id);
      audit(c.db, actor, featured ? 'listing_feature' : 'listing_unfeature', 'listing', c.params.id, { title: row.title });
    });
    c.json(200, { id: c.params.id, featured: !!featured });
  });

  r.get('/api/admin/users', (c) => {
    c.requireAdmin();
    const q = String(c.query.q || '').trim().slice(0, 80);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = c.db
      .prepare(
        `SELECT u.id, u.username, u.email, u.role, u.is_demo, u.created_at,
                (SELECT COUNT(*) FROM listings l WHERE l.seller_id = u.id) AS listings
         FROM users u
         WHERE ? = '' OR u.username LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'
         ORDER BY u.created_at DESC LIMIT 100`,
      )
      .all(q, like, like);
    c.json(200, { users: rows.map((u) => ({ ...u, is_demo: !!u.is_demo })), roles: ROLES });
  });

  r.post('/api/admin/users/:id/role', async (c) => {
    const actor = c.requireAdmin();
    const body = await c.readJson();
    const role = String(body.role || '');
    if (!ROLES.includes(role)) throw httpError(400, `The role must be one of: ${ROLES.join(', ')}.`);
    if (c.params.id === actor.id) throw httpError(400, 'You cannot change your own role. Ask another admin.');
    tx(c.db, () => {
      const target = c.db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(c.params.id);
      if (!target) throw httpError(404, 'User not found.');
      if (target.role === role) return;
      c.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
      if (role !== 'user') ensureProfile(c.db, target);
      audit(c.db, actor, 'role_change', 'user', target.id, { username: target.username, from: target.role, to: role });
    });
    c.json(200, { id: c.params.id, role });
  });

  r.get('/api/admin/audit', (c) => {
    c.requireAdmin();
    const limit = Math.min(Math.max(parseInt(c.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(c.query.offset, 10) || 0, 0);
    const rows = c.db
      .prepare('SELECT id, actor_name, action, target_type, target_id, detail, created_at FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
    const total = c.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    c.json(200, { entries: rows.map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })), total });
  });

  r.post('/api/admin/games', async (c) => {
    const actor = c.requireAdmin();
    const body = await c.readJson();
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 80) throw httpError(400, 'Enter a game name of 2 to 80 characters.');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw httpError(400, 'Enter a game name using letters or numbers.');
    const code = (String(body.code || '').trim() || name.split(/\s+/).map((w) => w[0]).join('')).toUpperCase().slice(0, 4);
    const details = readGameDetails(body);
    if (c.db.prepare('SELECT 1 FROM games WHERE slug = ?').get(slug)) throw httpError(409, 'That game already exists.');
    if (details.steam_app_id && c.db.prepare('SELECT 1 FROM games WHERE steam_app_id = ?').get(details.steam_app_id)) {
      throw httpError(409, 'A game with that Steam App ID already exists.');
    }
    const count = c.db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
    const keys = Object.keys(details);
    tx(c.db, () => {
      c.db
        .prepare(
          `INSERT INTO games (id, slug, name, code, tint, metadata_source, metadata_updated_at${keys.map((k) => `, ${k}`).join('')})
           VALUES (?,?,?,?,?,'manual',?${keys.map(() => ',?').join('')})`,
        )
        .run(crypto.randomUUID(), slug, name, code, (count % 8) + 1, Date.now(), ...keys.map((k) => details[k]));
      audit(c.db, actor, 'game_create', 'game', slug, { name });
    });
    c.json(201, { slug, name, code });
  });

  r.patch('/api/admin/games/:slug', async (c) => {
    const actor = c.requireAdmin();
    const details = readGameDetails(await c.readJson());
    const keys = Object.keys(details);
    if (!keys.length) throw httpError(400, 'Nothing to change.');
    if (details.steam_app_id) {
      const clash = c.db.prepare('SELECT 1 FROM games WHERE steam_app_id = ? AND slug != ?').get(details.steam_app_id, c.params.slug);
      if (clash) throw httpError(409, 'Another game already has that Steam App ID.');
    }
    tx(c.db, () => {
      const res = c.db
        .prepare(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(', ')}, metadata_source = 'manual', metadata_updated_at = ? WHERE slug = ?`)
        .run(...keys.map((k) => details[k]), Date.now(), c.params.slug);
      if (!res.changes) throw httpError(404, 'Game not found.');
      audit(c.db, actor, 'game_update', 'game', c.params.slug, { fields: keys });
    });
    c.json(200, { slug: c.params.slug });
  });
}
