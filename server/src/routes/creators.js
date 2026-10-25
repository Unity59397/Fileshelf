import { httpError, rateLimit } from '../http.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { CARD_SQL, card } from './listings.js';

function readProfile(body) {
  const displayName = String(body.display_name ?? '').replace(/\s+/g, ' ').trim();
  const bio = String(body.bio ?? '').replace(/\r\n?/g, '\n').trim();
  if (displayName.length < 2 || displayName.length > 40) throw httpError(400, 'The display name needs 2 to 40 characters.');
  if (/[\u0000-\u001f\u007f<>]/.test(displayName)) throw httpError(400, 'The display name cannot contain those characters.');
  if (bio.length > 500) throw httpError(400, 'The bio must be 500 characters or fewer.');
  return { displayName, bio };
}

const PROFILE_SQL = `
  SELECT u.username, cp.display_name, cp.bio, cp.created_at,
         (SELECT COUNT(*) FROM listings l WHERE l.seller_id = u.id AND l.status = 'approved') AS listing_count,
         (SELECT MAX(l.updated_at) FROM listings l WHERE l.seller_id = u.id AND l.status = 'approved') AS latest
  FROM creator_profiles cp JOIN users u ON u.id = cp.user_id`;

const publicProfile = (p) => ({
  username: p.username,
  display_name: p.display_name,
  bio: p.bio,
  joined: p.created_at,
  listings: p.listing_count,
});

export function register(r) {
  // Creators who have at least one approved listing, most recently active first.
  r.get('/api/creators', (c) => {
    const rows = c.db.prepare(`${PROFILE_SQL} WHERE listing_count > 0 ORDER BY latest DESC LIMIT 60`).all();
    c.json(200, { creators: rows.map(publicProfile) });
  });

  r.get('/api/creators/:username', (c) => {
    const profile = c.db.prepare(`${PROFILE_SQL} WHERE u.username = ?`).get(c.params.username);
    if (!profile) throw httpError(404, 'Creator not found.');
    const rows = c.db
      .prepare(`${CARD_SQL} WHERE l.seller_id = (SELECT id FROM users WHERE username = ?) AND l.status = 'approved' ORDER BY l.updated_at DESC`)
      .all(c.params.username);
    c.json(200, { creator: publicProfile(profile), listings: rows.map(card) });
  });

  r.get('/api/me/creator', (c) => {
    const user = c.requireUser();
    const profile = c.db.prepare(`${PROFILE_SQL} WHERE u.id = ?`).get(user.id);
    c.json(200, { profile: profile ? publicProfile(profile) : null });
  });

  // Becoming a creator is self-service. Publishing still needs a moderator to approve each listing.
  r.post('/api/me/creator', async (c) => {
    const user = c.requireUser();
    rateLimit(`creator:${user.id}`, 20, 60 * 60 * 1000);
    const { displayName, bio } = readProfile(await c.readJson());
    const now = Date.now();
    tx(c.db, () => {
      const existing = c.db.prepare('SELECT 1 FROM creator_profiles WHERE user_id = ?').get(user.id);
      if (existing) {
        c.db.prepare('UPDATE creator_profiles SET display_name = ?, bio = ?, updated_at = ? WHERE user_id = ?').run(displayName, bio, now, user.id);
      } else {
        c.db
          .prepare('INSERT INTO creator_profiles (user_id, display_name, bio, created_at, updated_at) VALUES (?,?,?,?,?)')
          .run(user.id, displayName, bio, now, now);
      }
      if (user.role === 'user') {
        c.db.prepare("UPDATE users SET role = 'creator' WHERE id = ? AND role = 'user'").run(user.id);
        audit(c.db, user, 'creator_signup', 'user', user.id);
      }
    });
    const role = user.role === 'user' ? 'creator' : user.role;
    c.json(200, { profile: { username: user.username, display_name: displayName, bio }, role });
  });
}
