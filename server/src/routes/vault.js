import { httpError, rateLimit } from '../http.js';
import { CARD_SQL, card } from './listings.js';

// The Vault is a private list for each signed-in user: listings they saved and files they downloaded.
// It records downloads. It cannot know whether anything was installed on the player's computer.
export function register(r) {
  r.get('/api/me/vault', (c) => {
    const user = c.requireUser();
    const rows = c.db
      .prepare(
        `${CARD_SQL.replace('SELECT l.id,', 'SELECT sl.created_at AS saved_at, l.id,')}
         JOIN saved_listings sl ON sl.listing_id = l.id
         WHERE sl.user_id = ? ORDER BY sl.created_at DESC`,
      )
      .all(user.id);
    const owns = c.db.prepare("SELECT 1 FROM orders WHERE buyer_id = ? AND listing_id = ? AND status = 'paid'");
    const last = c.db.prepare('SELECT MAX(created_at) AS at FROM download_log WHERE user_id = ? AND listing_id = ?');
    c.json(200, {
      saved: rows.map((row) => {
        const available = row.status === 'approved';
        const can = row.price_pence === 0 ? available : row.status !== 'removed' && !!owns.get(user.id, row.id);
        return {
          ...card(row),
          saved_at: row.saved_at,
          available,
          can_download: can,
          last_downloaded_at: last.get(user.id, row.id).at,
        };
      }),
    });
  });

  r.post('/api/me/vault/:id', (c) => {
    const user = c.requireUser();
    rateLimit(`vault:${user.id}`, 200, 60 * 60 * 1000);
    const listing = c.db.prepare("SELECT id FROM listings WHERE id = ? AND status = 'approved'").get(c.params.id);
    if (!listing) throw httpError(404, 'Listing not found.');
    c.db
      .prepare('INSERT OR IGNORE INTO saved_listings (user_id, listing_id, created_at) VALUES (?,?,?)')
      .run(user.id, listing.id, Date.now());
    c.json(200, { id: listing.id, saved: true });
  });

  r.delete('/api/me/vault/:id', (c) => {
    const user = c.requireUser();
    c.db.prepare('DELETE FROM saved_listings WHERE user_id = ? AND listing_id = ?').run(user.id, c.params.id);
    c.json(200, { id: c.params.id, saved: false });
  });

  r.get('/api/me/downloads', (c) => {
    const user = c.requireUser();
    const rows = c.db
      .prepare(
        `SELECT d.id, d.created_at, f.orig_name AS file_name, f.size, f.sha256,
                l.id AS listing_id, l.title, l.version, l.status AS listing_status
         FROM download_log d
         JOIN files f ON f.id = d.file_id
         LEFT JOIN listings l ON l.id = d.listing_id
         WHERE d.user_id = ? ORDER BY d.created_at DESC, d.id DESC LIMIT 100`,
      )
      .all(user.id);
    c.json(200, { downloads: rows });
  });
}
