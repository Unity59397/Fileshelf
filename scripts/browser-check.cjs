// A hand-run browser check, not part of `npm test`. It needs Playwright, which this project does not depend on:
//   npm install --no-save playwright && npx playwright install chromium
// Start the server on a SCRATCH database that has been seeded (never a real site):
//   cd server && DATA_DIR=/tmp/fs-check npm run seed && DATA_DIR=/tmp/fs-check PORT=3411 npm start
// Then run:
//   BASE=http://localhost:3411 node scripts/browser-check.cjs
// It opens every public page at desktop and phone width (script errors, sideways overflow), then signs up a new
// creator on a phone, publishes a listing, approves it as a moderator, and visits the admin screens.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '';
const PASSWORD = 'placeholder-password';
const problems = [];
const note = (m) => problems.push(m);
const text = async (page) => (await page.locator('#content').innerText()).replace(/\s+/g, ' ');
const ignorable = (t) => /ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fonts\.g/.test(t); // web fonts blocked offline

function watch(page, label) {
  page.on('pageerror', (e) => note(`${label}: script error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) note(`${label}: console error: ${m.text()}`); });
}
async function overflow(page, label) {
  const px = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (px > 1) note(`${label}: page is ${px}px wider than the screen`);
}
async function signIn(page, email) {
  await page.goto(BASE + '/#/signin');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('form button[type="submit"]');
  await page.waitForTimeout(700);
}
async function signOutPhone(page) { await page.click('.menu-btn'); await page.click('.sheet-out'); await page.waitForTimeout(400); }
function expect(cond, message) { if (!cond) note(message); }

(async () => {
  const browser = await chromium.launch();
  const first = await (await fetch(BASE + '/api/listings?limit=1')).json();
  const listingId = first.listings[0] && first.listings[0].id;
  if (!listingId) throw new Error('The site has no approved listings. Seed the scratch database first.');

  // 1. Public pages, signed out
  const pages = ['/', '/browse', '/browse?game=elden-ring', '/browse?category=mods', '/intel', '/games/elden-ring', '/search?q=elden',
    '/search?q=zzzzzz', '/creators', '/creators/demo_creator_one', '/listing/' + listingId, '/help', '/terms', '/signin', '/signup', '/nope'];
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    watch(page, name);
    for (const p of pages) {
      await page.goto(BASE + '/#' + p);
      await page.waitForSelector('#content h1', { timeout: 6000 }).catch(() => note(`${name} ${p}: no heading`));
      await page.waitForTimeout(250);
      await overflow(page, `${name} ${p}`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${p.replace(/\W+/g, '_')}.png`), fullPage: true });
    }
    for (const p of ['/vault', '/sell', '/admin']) {
      await page.goto(BASE + '/#' + p);
      await page.waitForTimeout(400);
      expect(page.url().includes('#/signin'), `${name} ${p}: signed-out visitor was not sent to sign in`);
    }
    await ctx.close();
  }

  // 2. Creator, moderator, admin on a phone
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  watch(page, 'flow');
  const id = Math.random().toString(36).slice(2, 8);
  const title = 'Browser check ' + id;
  const file = path.join(os.tmpdir(), `fileshelf-check-${id}.zip`);
  fs.writeFileSync(file, 'PK test bytes');

  await page.goto(BASE + '/#/signup');
  await page.fill('input[name="email"]', `check_${id}@example.test`);
  await page.fill('input[name="username"]', 'check_' + id);
  await page.fill('input[name="password"]', 'a-long-test-password');
  await page.click('form button[type="submit"]');
  await page.waitForTimeout(800);
  await page.goto(BASE + '/#/sell');
  await page.waitForSelector('#creator-form');
  await page.click('#creator-form button[type="submit"]');
  await page.waitForSelector('#sell-form', { timeout: 5000 }).catch(() => note('the listing form did not appear after creating a creator profile'));
  await overflow(page, 'phone sell form');
  const edges = await page.evaluate(() => [...document.querySelectorAll('#sell-form .input, #sell-form .select, #sell-form .textarea')].map((e) => e.getBoundingClientRect().right));
  expect(edges.every((r) => r <= 390), 'a sell form field is wider than the phone screen');
  await page.fill('#title', title);
  await page.selectOption('#game', 'hades');
  await page.selectOption('#category', 'configs');
  await page.fill('#summary', 'Made by the browser check.');
  await page.fill('#description', 'This listing was created by scripts/browser-check.cjs and can be deleted.');
  await page.setInputFiles('#paid_file', file);
  await page.check('#agree');
  await page.click('#sell-form button[type="submit"]');
  await page.waitForTimeout(1500);
  expect((await text(page)).includes('Waiting for review'), 'the new listing is not shown as waiting for review');

  await signOutPhone(page);
  await signIn(page, 'moderator@fileshelf.test');
  await page.goto(BASE + '/#/admin');
  await page.waitForSelector('.review', { timeout: 5000 }).catch(() => note('the review queue is empty'));
  await page.locator('.review', { hasText: title }).locator('[data-approve]').click();
  await page.waitForTimeout(800);
  expect(!(await text(page)).includes(title), 'the listing is still in the queue after approval');
  expect((await (await fetch(BASE + '/api/listings?q=' + encodeURIComponent(title))).json()).total === 1, 'the approved listing is not public');

  await signOutPhone(page);
  await signIn(page, 'admin@fileshelf.test');
  for (const tab of ['users', 'games', 'audit']) {
    await page.goto(BASE + '/#/admin/' + tab);
    await page.waitForSelector('#content h1');
    await page.waitForTimeout(350);
    await overflow(page, 'phone admin ' + tab);
  }
  expect((await text(page)).includes('Approved a listing'), 'the audit log does not show the approval');

  fs.rmSync(file, { force: true });
  await browser.close();
  if (problems.length) { console.log('Problems:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('Browser check passed.');
})().catch((e) => { console.error(e); process.exit(1); });
