// Fills a development database with DEMO accounts and listings, so the site has something to show.
//   npm run seed
// Everything it creates is marked as demo data (is_demo = 1) and the site says so wherever it appears.
// The files are random bytes and do nothing. Never run this against a real site: the passwords are public.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { openDb, seedGames } from './db.js';
import { hashPassword } from './auth.js';
import { storeUpload } from './storage.js';

const cfg = loadConfig();
if (cfg.production) throw new Error('Refusing to seed demo data in production.');

fs.mkdirSync(cfg.tmpDir, { recursive: true });
fs.mkdirSync(cfg.storageDir, { recursive: true });
const db = openDb(cfg.dbFile);
seedGames(db);

const PASSWORD = 'placeholder-password';
async function user(username, email, role = 'user', displayName = null) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO users (id, email, username, password_hash, role, payouts_enabled, is_demo, created_at) VALUES (?,?,?,?,?,1,1,?)').run(
    id, email, username, await hashPassword(PASSWORD), role, now,
  );
  if (displayName) {
    db.prepare('INSERT INTO creator_profiles (user_id, display_name, bio, created_at, updated_at) VALUES (?,?,?,?,?)').run(
      id, displayName, 'Demo account made by the seed script. It is not a real creator.', now, now,
    );
  }
  return id;
}

const adminEmail = cfg.adminEmail || 'admin@fileshelf.test';
await user('demo_admin', adminEmail, 'admin');
await user('demo_moderator', 'moderator@fileshelf.test', 'moderator');
const creators = [
  await user('demo_creator_one', 'creator1@fileshelf.test', 'creator', 'Demo Creator One'),
  await user('demo_creator_two', 'creator2@fileshelf.test', 'creator', 'Demo Creator Two'),
];
await user('demo_member', 'member@fileshelf.test');

const DEMO = [
  ['Demo: Save backup helper', 'stardew-valley', 'save-tools', 'Copies the save folder to a dated backup before each session.', ['Dated backups', 'One-step restore', 'Keeps the last ten copies']],
  ['Demo: Texture pack sampler', 'skyrim-special-edition', 'mods', 'A small set of texture replacements.', ['Four texture sets', 'Load order notes', 'Removal steps']],
  ['Demo: Controller layout preset', 'elden-ring', 'configs', 'An alternative button layout for gamepads.', ['Two layouts', 'Left-handed option', 'Import steps']],
  ['Demo: Frame pacing settings', 'cyberpunk-2077', 'utilities', 'A settings file aimed at steadier frame times.', ['Three quality tiers', 'Notes on each setting', 'Easy to undo']],
  ['Demo: Larger subtitle preset', 'baldurs-gate-3', 'utilities', 'Bigger, higher-contrast subtitles.', ['Three sizes', 'High-contrast option', 'Install notes']],
  ['Demo: Quest log notes', 'the-witcher-3', 'other', 'A printable checklist of side quests.', ['By region', 'Spoiler-free headings', 'PDF and text']],
  ['Demo: Settlement layout tweaks', 'fallout-4', 'mods', 'Small changes to how settlements lay out.', ['Snap points', 'Extra decorations', 'Works with the base game']],
  ['Demo: Run statistics viewer', 'hades', 'other', 'Reads a save file and shows run statistics.', ['Per-run table', 'Export to CSV', 'Read-only']],
];

if (db.prepare('SELECT COUNT(*) AS n FROM listings').get().n === 0) {
  const ctx = { cfg, db };
  const prices = cfg.payments === 'off' ? [] : [499, 0, 1250, 0, 0, 999, 1500, 0];
  const tmp = (name, size) => {
    const p = path.join(cfg.tmpDir, crypto.randomUUID());
    fs.writeFileSync(p, crypto.randomBytes(size));
    return { filename: name, path: p, size };
  };
  for (let i = 0; i < DEMO.length; i++) {
    const [title, gameSlug, category, summary, features] = DEMO[i];
    const owner = creators[i % 2];
    const game = db.prepare('SELECT id FROM games WHERE slug = ?').get(gameSlug);
    const price = prices[i] ?? 0;
    const paid = await storeUpload(ctx, tmp(`demo-${i + 1}.zip`, 40000), 'paid', owner);
    const free = price > 0 && i % 3 === 0 ? await storeUpload(ctx, tmp(`demo-${i + 1}-free.zip`, 8000), 'free', owner) : null;
    const now = Date.now() - i * 3600_000;
    db.prepare(
      `INSERT INTO listings (id, seller_id, game_id, category_id, title, summary, description, features, version,
                             price_pence, status, paid_file_id, free_file_id, featured, is_demo, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    ).run(
      crypto.randomUUID(), owner, game.id, category, title, summary,
      `${summary}\n\nThis is demo data created by the seed script so the site has something to show. The file attached to it is random bytes and does nothing.`,
      JSON.stringify(features), '1.0', price, i === 7 ? 'pending' : 'approved', paid, free,
      i === 0 || i === 3 ? 1 : 0, now, now,
    );
  }
}

console.log(`Seeded demo data. Sign in with any of these (password: ${PASSWORD}):`);
console.log(`  ${adminEmail} (admin), moderator@fileshelf.test, creator1@fileshelf.test, creator2@fileshelf.test, member@fileshelf.test`);
db.close();
