import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrations/index.js';
import { STARTER_GAMES } from './games-data.js';

// Opens the database and brings its structure up to date. The structure lives in src/migrations.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, file);
  return db;
}

// Run fn inside one transaction. Everything inside commits together or not at all.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Adds the starter games to an empty database. Earlier versions created six placeholder games
// ("Game One" and so on). Those are removed if nothing uses them.
export function seedGames(db) {
  db.exec(
    `DELETE FROM games
     WHERE slug GLOB 'game-0[1-6]' AND name GLOB 'Game *'
       AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.game_id = games.id)`,
  );
  if (db.prepare('SELECT COUNT(*) AS n FROM games').get().n > 0) return;
  const insert = db.prepare(
    `INSERT INTO games (id, slug, name, code, tint, steam_app_id, developer, publisher, release_date, genres,
                        description, metadata_source, metadata_updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',?)`,
  );
  const now = Date.now();
  for (const g of STARTER_GAMES) {
    insert.run(
      crypto.randomUUID(), g.slug, g.name, g.code, g.tint, g.steam_app_id, g.developer, g.publisher,
      g.release_date, g.genres, g.description, now,
    );
  }
}
