// The schema as it was before migrations existed. Uses IF NOT EXISTS, so a database created by an older
// build is recognised and simply marked as migrated.
export const id = '001_baseline';

export function up(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  stripe_account TEXT,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  tint INTEGER NOT NULL DEFAULT 1
);

-- Every uploaded file. stored_path is relative to the private storage folder and is never served directly.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('paid','free','image')),
  orig_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  mime TEXT,
  scan_status TEXT NOT NULL DEFAULT 'unscanned' CHECK (scan_status IN ('unscanned','clean')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  features TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL DEFAULT '1.0',
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','withdrawn','removed')),
  reject_reason TEXT,
  paid_file_id TEXT NOT NULL REFERENCES files(id),
  free_file_id TEXT REFERENCES files(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);

CREATE TABLE IF NOT EXISTS listing_images (
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (listing_id, file_id)
);

-- One row per purchase attempt. Amounts are whole pence. A paid order is the buyer's licence to download.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  amount_pence INTEGER NOT NULL,
  fee_pence INTEGER NOT NULL,
  seller_net_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','refunded','failed')),
  provider TEXT NOT NULL,
  provider_ref TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
-- A buyer can only own a listing once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_paid ON orders(buyer_id, listing_id) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id, status);

CREATE TABLE IF NOT EXISTS download_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
`);
}
