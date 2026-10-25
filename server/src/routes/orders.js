import crypto from 'node:crypto';
import fs from 'node:fs';
import { httpError, rateLimit, readBody, securityHeaders } from '../http.js';
import { filePath, signToken, verifyToken, contentDisposition } from '../storage.js';
import { isModerator } from '../auth.js';
import {
  splitAmount,
  markOrderPaid,
  createCheckout,
  startPayoutSetup,
  verifyStripeSignature,
  handleStripeEvent,
} from '../payments.js';

const hasPaidOrder = (db, userId, listingId) =>
  !!db
    .prepare("SELECT 1 FROM orders WHERE buyer_id = ? AND listing_id = ? AND status = 'paid'")
    .get(userId, listingId);

export function register(r) {
  // ---- Buying ----
  r.post('/api/listings/:id/checkout', async (c) => {
    const user = c.requireUser();
    rateLimit(`checkout:${user.id}`, 30, 60 * 60 * 1000);
    const { db, cfg } = c;
    if (cfg.payments === 'off') throw httpError(404, 'Paid downloads are not available yet.');
    const listing = db
      .prepare(
        `SELECT l.*, u.stripe_account, u.payouts_enabled
         FROM listings l JOIN users u ON u.id = l.seller_id
         WHERE l.id = ? AND l.status = 'approved'`,
      )
      .get(c.params.id);
    if (!listing) throw httpError(404, 'Listing not found.');
    if (listing.price_pence === 0) throw httpError(400, 'This listing is free. Use the download button.');
    if (listing.seller_id === user.id) throw httpError(400, 'You cannot buy your own listing.');
    if (hasPaidOrder(db, user.id, listing.id)) throw httpError(409, 'You already own this listing.');

    const { fee, net } = splitAmount(cfg, listing.price_pence);
    let order = db
      .prepare("SELECT * FROM orders WHERE buyer_id = ? AND listing_id = ? AND status = 'pending'")
      .get(user.id, listing.id);
    if (order) {
      // Reuse the open order, but charge today's price.
      db.prepare('UPDATE orders SET amount_pence = ?, fee_pence = ?, seller_net_pence = ?, provider = ? WHERE id = ?').run(
        listing.price_pence, fee, net, cfg.payments, order.id,
      );
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    } else {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO orders (id, buyer_id, listing_id, amount_pence, fee_pence, seller_net_pence, status, provider, created_at)
         VALUES (?,?,?,?,?,?,'pending',?,?)`,
      ).run(id, user.id, listing.id, listing.price_pence, fee, net, cfg.payments, Date.now());
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    }

    const result = await createCheckout(cfg, {
      order,
      listing,
      seller: { stripe_account: listing.stripe_account, payouts_enabled: listing.payouts_enabled },
    });
    if (result.provider_ref) {
      db.prepare('UPDATE orders SET provider_ref = ? WHERE id = ?').run(result.provider_ref, order.id);
    }
    c.json(200, result);
  });

  r.get('/api/orders/:id', (c) => {
    const user = c.requireUser();
    const row = c.db
      .prepare(
        `SELECT o.id, o.status, o.amount_pence, o.provider, l.id AS listing_id, l.title
         FROM orders o JOIN listings l ON l.id = o.listing_id
         WHERE o.id = ? AND o.buyer_id = ?`,
      )
      .get(c.params.id, user.id);
    if (!row) throw httpError(404, 'Order not found.');
    c.json(200, { order: row });
  });

  // Test payments only. Disabled whenever real payments are on.
  r.post('/api/orders/:id/mock-pay', (c) => {
    if (c.cfg.payments !== 'mock') throw httpError(404, 'Not found.');
    const user = c.requireUser();
    const order = c.db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(c.params.id, user.id);
    if (!order) throw httpError(404, 'Order not found.');
    if (order.status === 'paid') return c.json(200, { ok: true });
    const paid = markOrderPaid(c.db, order.id, `mock_${crypto.randomUUID()}`);
    if (!paid) throw httpError(409, 'This order cannot be paid.');
    c.json(200, { ok: true });
  });

  r.get('/api/me/orders', (c) => {
    const user = c.requireUser();
    const rows = c.db
      .prepare(
        `SELECT o.id, o.status, o.amount_pence, o.created_at, o.paid_at,
                l.id AS listing_id, l.title, l.status AS listing_status,
                g.name AS game_name, g.code AS game_code, g.tint AS game_tint, u.username AS seller
         FROM orders o
         JOIN listings l ON l.id = o.listing_id
         JOIN games g ON g.id = l.game_id
         JOIN users u ON u.id = l.seller_id
         WHERE o.buyer_id = ? AND o.status IN ('paid','refunded')
         ORDER BY o.created_at DESC`,
      )
      .all(user.id);
    c.json(200, {
      orders: rows.map((o) => ({ ...o, can_download: o.status === 'paid' && o.listing_status !== 'removed' })),
    });
  });

  r.get('/api/me/sales', (c) => {
    const user = c.requireUser();
    const rows = c.db
      .prepare(
        `SELECT o.id, o.amount_pence, o.fee_pence, o.seller_net_pence, o.paid_at, o.status,
                l.title, b.username AS buyer
         FROM orders o
         JOIN listings l ON l.id = o.listing_id
         JOIN users b ON b.id = o.buyer_id
         WHERE l.seller_id = ? AND o.status IN ('paid','refunded')
         ORDER BY o.paid_at DESC`,
      )
      .all(user.id);
    const paid = rows.filter((x) => x.status === 'paid');
    const sum = (k) => paid.reduce((n, x) => n + x[k], 0);
    c.json(200, {
      sales: rows,
      totals: { count: paid.length, gross_pence: sum('amount_pence'), fee_pence: sum('fee_pence'), net_pence: sum('seller_net_pence') },
      payouts_enabled: !!user.payouts_enabled,
      payments: c.cfg.payments,
    });
  });

  r.post('/api/me/payouts/connect', async (c) => {
    const user = c.requireUser();
    if (c.cfg.payments === 'off') throw httpError(404, 'Payouts are not available yet.');
    c.json(200, await startPayoutSetup(c.cfg, c.db, user));
  });

  // ---- Downloading ----
  r.post('/api/listings/:id/download-link', async (c) => {
    const { db, cfg, user } = c;
    const body = await c.readJson();
    const kind = body.kind === 'free' ? 'free' : 'paid';
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(c.params.id);
    if (!listing) throw httpError(404, 'Listing not found.');
    const staff = !!user && (user.id === listing.seller_id || isModerator(user));
    rateLimit(`dl:${user ? user.id : c.ip}`, 60, 60 * 60 * 1000);

    let fileId;
    if (kind === 'free') {
      // The separate free version of a paid listing. Anyone can download it once the listing is live.
      if (!listing.free_file_id || (listing.status !== 'approved' && !staff)) throw httpError(404, 'There is no free file for this listing.');
      fileId = listing.free_file_id;
    } else {
      if (!user) throw httpError(401, 'Sign in to download this file.');
      // A free listing can be downloaded by any signed-in user while it is live.
      // Someone who bought a paid listing keeps access unless a moderator removed it.
      const free = listing.price_pence === 0;
      const allowed = free
        ? listing.status === 'approved'
        : listing.status !== 'removed' && hasPaidOrder(db, user.id, listing.id);
      if (!staff && !allowed) {
        if (listing.status === 'removed') throw httpError(404, 'This listing has been removed.');
        if (free) throw httpError(404, 'Listing not found.');
        throw httpError(403, 'Buy this listing to download the full file.');
      }
      fileId = listing.paid_file_id;
    }
    const file = db.prepare('SELECT orig_name FROM files WHERE id = ?').get(fileId);
    const token = signToken(cfg.secret, {
      f: fileId,
      l: listing.id,
      u: user ? user.id : null,
      exp: Math.floor(Date.now() / 1000) + cfg.downloadLinkSeconds,
    });
    c.json(200, { url: `/api/download/${token}`, filename: file.orig_name, expires_in: cfg.downloadLinkSeconds });
  });

  r.get('/api/download/:token', (c) => {
    const payload = verifyToken(c.cfg.secret, c.params.token);
    if (!payload) throw httpError(403, 'This download link has expired. Go back and press Download again.');
    const file = c.db.prepare('SELECT * FROM files WHERE id = ?').get(payload.f);
    if (!file) throw httpError(404, 'File not found.');
    // A link made a moment ago stops working if the listing has since been taken down.
    const listing = payload.l ? c.db.prepare('SELECT seller_id, status FROM listings WHERE id = ?').get(payload.l) : null;
    if (listing && listing.status === 'removed') {
      const who = payload.u ? c.db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.u) : null;
      const staff = !!who && (who.id === listing.seller_id || isModerator(who));
      if (!staff) throw httpError(404, 'This file is no longer available.');
    }
    const full = filePath(c.cfg, file);
    if (!fs.existsSync(full)) throw httpError(404, 'File not found.');
    c.db.prepare('INSERT INTO download_log (file_id, listing_id, user_id, ip, created_at) VALUES (?,?,?,?,?)').run(
      file.id, payload.l ?? null, payload.u, c.ip, Date.now(),
    );
    securityHeaders(c.res);
    c.res.writeHead(200, {
      // Always a generic type, so a browser never tries to open an uploaded file.
      'Content-Type': 'application/octet-stream',
      'Content-Length': file.size,
      'Content-Disposition': contentDisposition(file.orig_name),
      'Cache-Control': 'private, no-store',
    });
    if (c.req.method === 'HEAD') return c.res.end();
    fs.createReadStream(full).pipe(c.res);
  });

  r.get('/api/images/:id', (c) => {
    const row = c.db
      .prepare(
        `SELECT f.*, l.status, l.seller_id FROM files f
         JOIN listing_images li ON li.file_id = f.id
         JOIN listings l ON l.id = li.listing_id
         WHERE f.id = ? AND f.kind = 'image'`,
      )
      .get(c.params.id);
    const staff = !!(row && c.user && (c.user.id === row.seller_id || isModerator(c.user)));
    if (!row || (row.status !== 'approved' && !staff)) throw httpError(404, 'Image not found.');
    const full = filePath(c.cfg, row);
    securityHeaders(c.res);
    c.res.writeHead(200, {
      'Content-Type': row.mime,
      'Content-Length': row.size,
      'Cache-Control': row.status === 'approved' ? 'public, max-age=3600' : 'private, no-store',
      'Content-Security-Policy': "default-src 'none'",
    });
    if (c.req.method === 'HEAD') return c.res.end();
    fs.createReadStream(full).pipe(c.res);
  });

  // ---- Stripe webhook ----
  r.post('/api/stripe/webhook', async (c) => {
    if (c.cfg.payments !== 'stripe') throw httpError(404, 'Not found.');
    if (!c.cfg.stripeWebhookSecret) throw httpError(500, 'The webhook secret is not set.');
    const raw = (await readBody(c.req, 1024 * 1024)).toString('utf8');
    if (!verifyStripeSignature(raw, c.req.headers['stripe-signature'], c.cfg.stripeWebhookSecret)) {
      throw httpError(400, 'Invalid signature.');
    }
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw httpError(400, 'Invalid payload.');
    }
    handleStripeEvent(c.db, event);
    c.json(200, { received: true });
  });
}
