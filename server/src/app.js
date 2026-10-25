import http from 'node:http';
import fs from 'node:fs';
import { openDb, seedGames } from './db.js';
import { Router, HttpError, httpError, json, readJson, securityHeaders, serveStatic } from './http.js';
import { sessionUser, purgeExpiredSessions, isModerator, isAdmin, canPublish } from './auth.js';
import { register as registerAuth } from './routes/auth.js';
import { register as registerListings } from './routes/listings.js';
import { register as registerOrders } from './routes/orders.js';
import { register as registerAdmin } from './routes/admin.js';
import { register as registerCreators } from './routes/creators.js';
import { register as registerVault } from './routes/vault.js';

class Ctx {
  constructor(req, res, cfg, db, params, url) {
    this.req = req;
    this.res = res;
    this.cfg = cfg;
    this.db = db;
    this.params = params;
    this.query = Object.fromEntries(url.searchParams);
    this.ip = cfg.trustProxy
      ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
      : req.socket.remoteAddress;
    this.user = sessionUser(db, req);
  }
  json(status, body) {
    json(this.res, status, body);
  }
  readJson(limit) {
    return readJson(this.req, limit);
  }
  requireUser() {
    if (!this.user) throw httpError(401, 'Sign in to continue.');
    return this.user;
  }
  // Moderators review submissions. Admins can do everything a moderator can.
  requireModerator() {
    const user = this.requireUser();
    if (!isModerator(user)) throw httpError(403, 'This page is for moderators only.');
    return user;
  }
  requireAdmin() {
    const user = this.requireUser();
    if (!isAdmin(user)) throw httpError(403, 'This page is for admins only.');
    return user;
  }
  requireCreator() {
    const user = this.requireUser();
    if (!canPublish(user)) throw httpError(403, 'Set up a creator profile before you publish.');
    return user;
  }
}

// Browsers send an Origin header on cross-site requests. Refuse any write that came from another site.
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw httpError(403, 'Cross-site request blocked.');
  }
  if (host !== req.headers.host) throw httpError(403, 'Cross-site request blocked.');
}

export function createApp(cfg) {
  fs.mkdirSync(cfg.storageDir, { recursive: true });
  fs.mkdirSync(cfg.tmpDir, { recursive: true });
  // Leftovers from uploads that were interrupted.
  for (const name of fs.readdirSync(cfg.tmpDir)) {
    fs.rmSync(`${cfg.tmpDir}/${name}`, { force: true });
  }

  const db = openDb(cfg.dbFile);
  seedGames(db);
  purgeExpiredSessions(db);

  const router = new Router();
  registerAuth(router);
  registerListings(router);
  registerOrders(router);
  registerAdmin(router);
  registerCreators(router);
  registerVault(router);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const method = req.method;
    securityHeaders(res);

    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) throw httpError(405, 'Method not allowed.');
      if (method !== 'GET' && method !== 'HEAD') checkOrigin(req);
      const { handler, params, pathMatched } = router.match(method === 'HEAD' ? 'GET' : method, url.pathname);
      if (!handler) throw httpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed.' : 'Not found.');
      await handler(new Ctx(req, res, cfg, db, params, url));
      return;
    }
    if ((method === 'GET' || method === 'HEAD') && serveStatic(req, res, cfg.clientDir, url.pathname)) return;
    throw httpError(404, 'Not found.');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) {
        if (err.status === 413) res.setHeader('Connection', 'close');
        return json(res, err.status, { error: err.message });
      }
      console.error(err);
      json(res, 500, { error: 'Something went wrong on our side. Try again.' });
    });
  });
  server.requestTimeout = 0; // large uploads can take a while
  server.headersTimeout = 30000;

  const timer = setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000);
  timer.unref();

  return {
    server,
    db,
    close() {
      clearInterval(timer);
      return new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}
