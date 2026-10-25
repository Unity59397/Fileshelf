// Stage B foundation: roles, audit log, creator profiles, categories, game details, saved listings,
// and a listing id on download history.
export const id = '002_foundation';

export const CATEGORIES = [
  ['trainers', 'Single-player trainers', 'Tools that change values in a single-player game while you play.', 1],
  ['save-tools', 'Save editors and save utilities', 'Edit, back up and move save files.', 2],
  ['mods', 'Mods and mod packs', 'Content and gameplay changes, on their own or bundled.', 3],
  ['configs', 'Configuration files and presets', 'Ready-made settings, input maps and graphics presets.', 4],
  ['utilities', 'Performance and accessibility utilities', 'Tools for frame rate, loading times, readability and controls.', 5],
  ['other', 'Other approved tools', 'Game-specific tools that do not fit anywhere else.', 6],
];

export function up(db) {
  // SQLite cannot change a CHECK constraint in place, so the users table is rebuilt.
  // The migration runner turns foreign keys off for this and checks them again afterwards.
  db.exec(`
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','creator','moderator','admin')),
  stripe_account TEXT,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO users_new (id, email, username, password_hash, role, stripe_account, payouts_enabled, created_at)
  SELECT id, email, username, password_hash, role, stripe_account, payouts_enabled, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
`);

  db.exec(`
-- Moderation and administration actions. Append-only: the triggers refuse edits and deletes.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'The audit log cannot be changed.'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'The audit log cannot be changed.'); END;

CREATE TABLE creator_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  position INTEGER NOT NULL
);

ALTER TABLE listings ADD COLUMN category_id TEXT REFERENCES categories(id);
ALTER TABLE listings ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_listings_game ON listings(game_id, status);
CREATE INDEX idx_listings_category ON listings(category_id, status);

ALTER TABLE games ADD COLUMN steam_app_id INTEGER;
ALTER TABLE games ADD COLUMN developer TEXT;
ALTER TABLE games ADD COLUMN publisher TEXT;
ALTER TABLE games ADD COLUMN release_date TEXT;
ALTER TABLE games ADD COLUMN description TEXT;
ALTER TABLE games ADD COLUMN genres TEXT;
ALTER TABLE games ADD COLUMN official_url TEXT;
ALTER TABLE games ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE games ADD COLUMN metadata_updated_at INTEGER;
CREATE UNIQUE INDEX idx_games_steam ON games(steam_app_id) WHERE steam_app_id IS NOT NULL;

CREATE TABLE saved_listings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

ALTER TABLE download_log ADD COLUMN listing_id TEXT;
UPDATE download_log SET listing_id = (
  SELECT l.id FROM listings l WHERE l.paid_file_id = download_log.file_id OR l.free_file_id = download_log.file_id
);
CREATE INDEX idx_downloads_user ON download_log(user_id, created_at);
`);

  // Anyone who already has listings becomes a creator and gets a profile, so their pages keep working.
  db.exec(`
UPDATE users SET role = 'creator' WHERE role = 'user' AND id IN (SELECT seller_id FROM listings);
INSERT OR IGNORE INTO creator_profiles (user_id, display_name, bio, created_at, updated_at)
  SELECT id, username, '', created_at, created_at FROM users WHERE id IN (SELECT seller_id FROM listings);
`);

  const insert = db.prepare('INSERT INTO categories (id, name, description, position) VALUES (?,?,?,?)');
  for (const row of CATEGORIES) insert.run(...row);
  db.exec("UPDATE listings SET category_id = 'other' WHERE category_id IS NULL");
}
