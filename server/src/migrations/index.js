import fs from 'node:fs';
import * as m001 from './001_baseline.js';
import * as m002 from './002_foundation.js';

// Add new migrations to the end of this list. Never edit one that has been released.
export const MIGRATIONS = [m001, m002];

// Applies every migration that has not run yet, each in its own transaction.
// Foreign keys are switched off while a migration runs (SQLite needs that to rebuild a table)
// and checked again before it is committed. If a database already has accounts, a copy is saved first.
export function migrate(db, file) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  // Only a database that already holds accounts needs a safety copy. A new one has nothing to lose.
  const hasData = () =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() &&
    !!db.prepare('SELECT 1 FROM users LIMIT 1').get();

  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    if (file && file !== ':memory:' && hasData()) {
      const backup = `${file}.before-${m.id}`;
      if (!fs.existsSync(backup)) db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    }
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        m.up(db);
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`Migration ${m.id} would leave broken references, so it was not applied.`);
        db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?,?)').run(m.id, Date.now());
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
