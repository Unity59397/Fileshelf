import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { parseCookies, cookieHeader } from './http.js';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'fs_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return ['scrypt', salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, saltB64, keyB64] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Used when the email is unknown, so a wrong email takes as long as a wrong password.
let dummyHash;
export async function burnPasswordTime(password) {
  dummyHash ||= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readToken(req) {
  try {
    return parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || null;
  } catch {
    return null;
  }
}

export function createSession(db, cfg, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = cfg.sessionDays * 86400;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(
    sha(token),
    userId,
    Date.now() + maxAge * 1000,
  );
  return cookieHeader(SESSION_COOKIE, token, { maxAge, secure: cfg.production });
}

export function clearSessionCookie(cfg) {
  return cookieHeader(SESSION_COOKIE, '', { maxAge: 0, secure: cfg.production });
}

export function sessionUser(db, req) {
  const token = readToken(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.username, u.role, u.stripe_account, u.payouts_enabled, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
    return null;
  }
  return row;
}

export function destroySession(db, req) {
  const token = readToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// Roles, lowest to highest. Permissions are checked on the server from the role stored in the database.
export const ROLES = ['user', 'creator', 'moderator', 'admin'];
export const isModerator = (u) => !!u && (u.role === 'moderator' || u.role === 'admin');
export const isAdmin = (u) => !!u && u.role === 'admin';
export const canPublish = (u) => !!u && (u.role === 'creator' || u.role === 'moderator' || u.role === 'admin');

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  can_publish: canPublish(u),
  is_moderator: isModerator(u),
  is_admin: isAdmin(u),
  payouts_enabled: !!u.payouts_enabled,
});
