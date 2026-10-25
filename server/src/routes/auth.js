import crypto from 'node:crypto';
import { httpError, rateLimit } from '../http.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import {
  hashPassword,
  verifyPassword,
  burnPasswordTime,
  createSession,
  destroySession,
  clearSessionCookie,
  publicUser,
} from '../auth.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const USERNAME = /^[A-Za-z0-9_]{3,24}$/;

export function register(r) {
  // Settings the front end needs before anyone signs in.
  r.get('/api/config', (c) => {
    const { cfg } = c;
    c.json(200, {
      payments: cfg.payments,
      fee_percent: cfg.feeBps / 100,
      max_upload_mb: Math.round(cfg.maxUploadBytes / 1024 / 1024),
      max_image_mb: Math.round(cfg.maxImageBytes / 1024 / 1024),
      max_images: cfg.maxImages,
      min_price_pence: cfg.minPricePence,
      max_price_pence: cfg.maxPricePence,
      allowed_extensions: cfg.allowedExtensions,
      // True while the database holds listings or accounts made by the development seed script.
      demo_data: !!c.db.prepare('SELECT 1 FROM users WHERE is_demo = 1 LIMIT 1').get(),
      contact_email: cfg.contactEmail,
      // Live Steam player counts need a data source, which is not set up yet (planned for Stage D).
      player_counts: false,
    });
  });

  r.get('/api/stats', (c) => {
    const { db } = c;
    c.json(200, {
      listings: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'approved'").get().n,
      games: db.prepare('SELECT COUNT(*) AS n FROM games').get().n,
      sellers: db
        .prepare("SELECT COUNT(DISTINCT seller_id) AS n FROM listings WHERE status = 'approved'")
        .get().n,
    });
  });

  r.get('/api/auth/me', (c) => {
    c.json(200, { user: c.user ? publicUser(c.user) : null });
  });

  r.post('/api/auth/signup', async (c) => {
    rateLimit(`signup:${c.ip}`, 10, 60 * 60 * 1000);
    const body = await c.readJson();
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (email.length > 254 || !EMAIL.test(email)) throw httpError(400, 'Enter a valid email address.');
    if (!USERNAME.test(username)) {
      throw httpError(400, 'Usernames are 3 to 24 characters: letters, numbers and underscores.');
    }
    if (password.length < 10) throw httpError(400, 'Passwords need at least 10 characters.');
    if (password.length > 200) throw httpError(400, 'That password is too long.');

    const taken = c.db.prepare('SELECT 1 FROM users WHERE email = ? OR username = ?').get(email, username);
    if (taken) throw httpError(409, 'That email or username is already taken.');

    const id = crypto.randomUUID();
    const hash = await hashPassword(password);
    let role = 'user';
    try {
      tx(c.db, () => {
        // ADMIN_EMAIL only starts a new site off. It makes the first admin, and only while there is none.
        // After that, roles are changed by an existing admin, never by signing up with a particular address.
        const hasAdmin = !!c.db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
        if (c.cfg.adminEmail && email === c.cfg.adminEmail && !hasAdmin) role = 'admin';
        c.db
          .prepare('INSERT INTO users (id, email, username, password_hash, role, created_at) VALUES (?,?,?,?,?,?)')
          .run(id, email, username, hash, role, Date.now());
        if (role === 'admin') audit(c.db, { id, username }, 'bootstrap_admin', 'user', id, { email });
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw httpError(409, 'That email or username is already taken.');
      throw err;
    }
    c.res.setHeader('Set-Cookie', createSession(c.db, c.cfg, id));
    c.json(201, { user: publicUser({ id, email, username, role, payouts_enabled: 0 }) });
  });

  r.post('/api/auth/login', async (c) => {
    const body = await c.readJson();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    rateLimit(`login-ip:${c.ip}`, 30, 15 * 60 * 1000);
    rateLimit(`login-email:${email}`, 8, 15 * 60 * 1000);

    const user = c.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordTime(password), false);
    if (!ok) throw httpError(401, 'Email or password is incorrect.');
    // Accounts made by the seed script have a public password. They never work on a production site.
    if (user.is_demo && c.cfg.production) throw httpError(401, 'Email or password is incorrect.');

    c.res.setHeader('Set-Cookie', createSession(c.db, c.cfg, user.id));
    c.json(200, { user: publicUser(user) });
  });

  r.post('/api/auth/logout', (c) => {
    destroySession(c.db, c.req);
    c.res.setHeader('Set-Cookie', clearSessionCookie(c.cfg));
    c.json(200, { ok: true });
  });
}
