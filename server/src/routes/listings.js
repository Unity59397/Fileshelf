import crypto from 'node:crypto';
import { httpError, rateLimit } from '../http.js';
import { tx } from '../db.js';
import { isModerator } from '../auth.js';
import { parseMultipart } from '../multipart.js';
import { storeUpload, removeTemp, removeStored } from '../storage.js';
import { ensureProfile } from '../profiles.js';

export const CARD_SQL = `
  SELECT l.id, l.title, l.summary, l.price_pence, l.version, l.status, l.reject_reason, l.featured, l.is_demo,
         l.created_at, l.updated_at, (l.free_file_id IS NOT NULL) AS has_free,
         g.slug AS game_slug, g.name AS game_name, g.code AS game_code, g.tint AS game_tint,
         c.id AS category_id, c.name AS category_name,
         u.username AS seller, cp.display_name AS seller_display,
         (SELECT file_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY position LIMIT 1) AS cover_id
  FROM listings l
  JOIN games g ON g.id = l.game_id
  JOIN users u ON u.id = l.seller_id
  LEFT JOIN categories c ON c.id = l.category_id
  LEFT JOIN creator_profiles cp ON cp.user_id = l.seller_id`;

export function card(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    price_pence: row.price_pence,
    is_free: row.price_pence === 0,
    version: row.version,
    status: row.status,
    reject_reason: row.reject_reason || null,
    featured: !!row.featured,
    is_demo: !!row.is_demo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_free: !!row.has_free,
    cover_id: row.cover_id || null,
    seller: row.seller,
    seller_display: row.seller_display || row.seller,
    category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
    game: { slug: row.game_slug, name: row.game_name, code: row.game_code, tint: row.game_tint },
  };
}

// Turns "12.50" into 1250. Returns null for anything that is not a plain amount in pounds.
export function poundsToPence(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

function readFeatures(value) {
  let list = value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[')) {
      try {
        list = JSON.parse(t);
      } catch {
        throw httpError(400, 'The features list is not valid.');
      }
    } else list = t.split(/\r?\n/);
  }
  if (!Array.isArray(list)) return [];
  const out = list.map((s) => String(s).trim()).filter(Boolean);
  if (out.length > 12) throw httpError(400, 'Add at most 12 features.');
  if (out.some((s) => s.length > 120)) throw httpError(400, 'Each feature must be 120 characters or fewer.');
  return out;
}

function text(value, label, min, max) {
  // Browsers send line breaks in uploaded forms as CRLF. Store plain LF.
  const s = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (s.length < min) throw httpError(400, `${label} needs at least ${min} characters.`);
  if (s.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return s;
}

// Validates the text fields of a listing. Used when creating and when editing.
function readListing(f, cfg, db, { partial = false } = {}) {
  const out = {};
  const has = (k) => f[k] !== undefined;
  if (!partial || has('title')) out.title = text(f.title, 'The title', 3, 80);
  if (!partial || has('summary')) out.summary = text(f.summary, 'The summary', 3, 160);
  if (!partial || has('description')) out.description = text(f.description, 'The description', 3, 5000);
  if (!partial || has('features')) out.features = JSON.stringify(readFeatures(f.features ?? ''));
  if (!partial || has('version')) out.version = text(f.version || '1.0', 'The version', 1, 20);
  if (!partial || has('price')) {
    // A blank price means the listing is free.
    const raw = String(f.price ?? '').trim();
    const pence = raw === '' ? 0 : poundsToPence(raw);
    if (pence === null) throw httpError(400, 'Enter the price in pounds, for example 12.50, or leave it blank for a free listing.');
    if (pence !== 0) {
      if (cfg.payments === 'off') {
        throw httpError(400, 'Paid listings are not available yet. Leave the price blank to publish this listing for free.');
      }
      if (pence < cfg.minPricePence || pence > cfg.maxPricePence) {
        throw httpError(
          400,
          `The price must be between £${(cfg.minPricePence / 100).toFixed(2)} and £${(cfg.maxPricePence / 100).toFixed(2)}, or blank for free.`,
        );
      }
    }
    out.price_pence = pence;
  }
  if (!partial || has('category')) {
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(String(f.category || ''));
    if (!category) throw httpError(400, 'Choose a category.');
    out.category_id = category.id;
  }
  if (!partial) {
    const game = db.prepare('SELECT id FROM games WHERE id = ? OR slug = ?').get(String(f.game || ''), String(f.game || ''));
    if (!game) throw httpError(400, 'Choose a game.');
    out.game_id = game.id;
  }
  return out;
}

// The seller, moderators and admins can see a listing before it is approved.
function canSeeUnapproved(user, listing) {
  return !!user && (user.id === listing.seller_id || isModerator(user));
}

const GAME_SORTS = {
  name: 'g.name COLLATE NOCASE ASC',
  released: "COALESCE(g.release_date, '') DESC, g.name COLLATE NOCASE ASC",
  listings: 'listings DESC, g.name COLLATE NOCASE ASC',
};

const GAME_FIELDS = `g.slug, g.name, g.code, g.tint, g.steam_app_id, g.developer, g.publisher, g.release_date, g.genres,
  (SELECT COUNT(*) FROM listings l WHERE l.game_id = g.id AND l.status = 'approved') AS listings`;

export function register(r) {
  r.get('/api/categories', (c) => {
    const rows = c.db
      .prepare(
        `SELECT c.id, c.name, c.description,
                (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id AND l.status = 'approved') AS listings
         FROM categories c ORDER BY c.position`,
      )
      .all();
    c.json(200, { categories: rows });
  });

  r.get('/api/games', (c) => {
    const where = [];
    const args = [];
    const q = String(c.query.q || '').trim().slice(0, 80);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(g.name LIKE ? ESCAPE '\\' OR g.developer LIKE ? ESCAPE '\\' OR g.genres LIKE ? ESCAPE '\\' OR g.steam_app_id = ?)");
      args.push(like, like, like, /^\d{1,10}$/.test(q) ? Number(q) : -1);
    }
    const order = GAME_SORTS[c.query.sort] || GAME_SORTS.name;
    const rows = c.db
      .prepare(`SELECT ${GAME_FIELDS} FROM games g ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`)
      .all(...args);
    c.json(200, { games: rows });
  });

  // One game. Player counts are not collected yet, so the response says so instead of guessing.
  r.get('/api/games/:slug', (c) => {
    const game = c.db
      .prepare(
        `SELECT ${GAME_FIELDS}, g.description, g.official_url, g.metadata_source, g.metadata_updated_at
         FROM games g WHERE g.slug = ?`,
      )
      .get(c.params.slug);
    if (!game) throw httpError(404, 'Game not found.');
    c.json(200, {
      game: {
        ...game,
        store_url: game.steam_app_id ? `https://store.steampowered.com/app/${game.steam_app_id}/` : null,
      },
      players: { status: 'not_configured', current: null, updated_at: null },
    });
  });

  r.get('/api/listings', (c) => {
    const { game, category, q, sort } = c.query;
    const where = ["l.status = 'approved'"];
    const args = [];
    if (game) {
      where.push('g.slug = ?');
      args.push(game);
    }
    if (category) {
      where.push('l.category_id = ?');
      args.push(category);
    }
    if (q) {
      const like = `%${String(q).slice(0, 80).replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(l.title LIKE ? ESCAPE '\\' OR l.summary LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\')");
      args.push(like, like, like);
    }
    // "Free" means the listing costs nothing, or it has a free version to try.
    if (c.query.free === '1') where.push('(l.price_pence = 0 OR l.free_file_id IS NOT NULL)');
    if (c.query.featured === '1') where.push('l.featured = 1');
    const order =
      {
        price_asc: 'l.price_pence ASC, l.created_at DESC',
        price_desc: 'l.price_pence DESC, l.created_at DESC',
        new: 'l.created_at DESC',
        updated: 'l.updated_at DESC',
      }[sort] || 'l.created_at DESC';
    const limit = Math.min(Math.max(parseInt(c.query.limit, 10) || 24, 1), 48);
    const offset = Math.max(parseInt(c.query.offset, 10) || 0, 0);
    const base = `${CARD_SQL} WHERE ${where.join(' AND ')}`;
    const rows = c.db.prepare(`${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = c.db
      .prepare(
        `SELECT COUNT(*) AS n FROM listings l JOIN games g ON g.id = l.game_id WHERE ${where.join(' AND ')}`,
      )
      .get(...args).n;
    c.json(200, { listings: rows.map(card), total });
  });

  r.get('/api/listings/:id', (c) => {
    const row = c.db
      .prepare(
        `${CARD_SQL.replace('SELECT l.id,', 'SELECT l.seller_id, l.description, l.features, l.paid_file_id, l.free_file_id, l.id,')}
         WHERE l.id = ?`,
      )
      .get(c.params.id);
    if (!row || (row.status !== 'approved' && !canSeeUnapproved(c.user, row))) throw httpError(404, 'Listing not found.');

    const file = (id) =>
      id ? c.db.prepare('SELECT orig_name AS name, size, sha256, scan_status FROM files WHERE id = ?').get(id) : null;
    const images = c.db
      .prepare('SELECT file_id FROM listing_images WHERE listing_id = ? ORDER BY position')
      .all(row.id)
      .map((x) => x.file_id);
    const user = c.user;
    const owned = !!(
      user &&
      c.db
        .prepare("SELECT 1 FROM orders WHERE buyer_id = ? AND listing_id = ? AND status = 'paid'")
        .get(user.id, row.id)
    );
    const saved = !!(
      user && c.db.prepare('SELECT 1 FROM saved_listings WHERE user_id = ? AND listing_id = ?').get(user.id, row.id)
    );
    c.json(200, {
      listing: {
        ...card(row),
        description: row.description,
        features: JSON.parse(row.features),
        images,
        paid_file: file(row.paid_file_id),
        free_file: file(row.free_file_id),
        viewer: {
          is_seller: !!user && user.id === row.seller_id,
          is_admin: !!user && user.role === 'admin',
          is_moderator: isModerator(user),
          owned,
          saved,
        },
      },
    });
  });

  r.post('/api/listings', async (c) => {
    const user = c.requireCreator();
    rateLimit(`create:${user.id}`, 20, 60 * 60 * 1000);
    const { cfg, db } = c;
    const { fields, files } = await parseMultipart(c.req, {
      tmpDir: cfg.tmpDir,
      maxFileBytes: cfg.maxUploadBytes,
      maxFiles: 2 + cfg.maxImages,
    });
    const stored = [];
    try {
      const data = readListing(fields, cfg, db);
      const main = files.filter((f) => f.field === 'paid_file');
      const free = files.filter((f) => f.field === 'free_file');
      const images = files.filter((f) => f.field === 'images');
      if (main.length !== 1) throw httpError(400, 'Attach the file people will download.');
      if (free.length > 1) throw httpError(400, 'Attach only one free file.');
      if (free.length && data.price_pence === 0) throw httpError(400, 'A free listing does not need a separate free version.');
      if (images.length > cfg.maxImages) throw httpError(400, `Add at most ${cfg.maxImages} images.`);
      if (String(fields.agree) !== 'yes') {
        throw httpError(400, 'Confirm that you made this file or have permission to share it, and that it follows the rules.');
      }

      const ctx = { cfg, db };
      const paidId = await storeUpload(ctx, main[0], 'paid', user.id);
      stored.push(paidId);
      let freeId = null;
      if (free[0]) {
        freeId = await storeUpload(ctx, free[0], 'free', user.id);
        stored.push(freeId);
      }
      const imageIds = [];
      for (const img of images) {
        const id = await storeUpload(ctx, img, 'image', user.id);
        stored.push(id);
        imageIds.push(id);
      }

      const id = crypto.randomUUID();
      const now = Date.now();
      tx(db, () => {
        ensureProfile(db, user);
        db.prepare(
          `INSERT INTO listings (id, seller_id, game_id, category_id, title, summary, description, features, version,
                                 price_pence, status, paid_file_id, free_file_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
        ).run(
          id, user.id, data.game_id, data.category_id, data.title, data.summary, data.description, data.features,
          data.version, data.price_pence, paidId, freeId, now, now,
        );
        imageIds.forEach((fid, i) =>
          db.prepare('INSERT INTO listing_images (listing_id, file_id, position) VALUES (?,?,?)').run(id, fid, i),
        );
      });
      c.json(201, { id, status: 'pending' });
    } catch (err) {
      removeStored(cfg, db, stored);
      throw err;
    } finally {
      removeTemp(files);
    }
  });

  r.get('/api/me/listings', (c) => {
    const user = c.requireUser();
    const rows = c.db
      .prepare(
        `${CARD_SQL} WHERE l.seller_id = ? ORDER BY l.created_at DESC`,
      )
      .all(user.id);
    const sales = c.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE listing_id = ? AND status = 'paid'");
    const downloads = c.db.prepare('SELECT COUNT(*) AS n FROM download_log WHERE listing_id = ?');
    c.json(200, {
      listings: rows.map((row) => ({ ...card(row), sales: sales.get(row.id).n, downloads: downloads.get(row.id).n })),
    });
  });

  r.patch('/api/listings/:id', async (c) => {
    const user = c.requireUser();
    const listing = c.db.prepare('SELECT * FROM listings WHERE id = ?').get(c.params.id);
    if (!listing || listing.seller_id !== user.id) throw httpError(404, 'Listing not found.');
    if (['withdrawn', 'removed'].includes(listing.status)) {
      throw httpError(409, 'This listing is no longer active and cannot be edited.');
    }
    const body = await c.readJson();
    const data = readListing(body, c.cfg, c.db, { partial: true });
    const keys = Object.keys(data);
    if (!keys.length) throw httpError(400, 'Nothing to change.');
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    // Any edit goes back to review, so a listing cannot be swapped for something else after approval.
    c.db
      .prepare(`UPDATE listings SET ${sets}, status = 'pending', reject_reason = NULL, featured = 0, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => data[k]), Date.now(), listing.id);
    c.json(200, { id: listing.id, status: 'pending' });
  });

  r.post('/api/listings/:id/withdraw', (c) => {
    const user = c.requireUser();
    const res = c.db
      .prepare("UPDATE listings SET status = 'withdrawn', featured = 0, updated_at = ? WHERE id = ? AND seller_id = ? AND status IN ('pending','approved','rejected')")
      .run(Date.now(), c.params.id, user.id);
    if (!res.changes) throw httpError(404, 'Listing not found.');
    c.json(200, { id: c.params.id, status: 'withdrawn' });
  });
}
