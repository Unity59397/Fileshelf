// Every account that can publish has a creator profile. This makes one if it is missing.
export function ensureProfile(db, user) {
  const now = Date.now();
  db.prepare(
    'INSERT OR IGNORE INTO creator_profiles (user_id, display_name, bio, created_at, updated_at) VALUES (?,?,?,?,?)',
  ).run(user.id, user.username, '', now, now);
}
