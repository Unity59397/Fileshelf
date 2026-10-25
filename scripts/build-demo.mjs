// Builds a single-file demo that runs entirely in the browser (no server, no uploads).
//   node scripts/build-demo.mjs [output-file]               writes the page content only (for publishing as an artifact)
//   node scripts/build-demo.mjs --standalone [output-file]  writes a complete page you can open from your disk
// The demo uses scripts/demo-api.js in place of the server. Everything else is the real front end.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'client');
const args = process.argv.slice(2);
const standalone = args.includes('--standalone');
const target = args.find((a) => !a.startsWith('--'));
const out = path.resolve(target || (standalone ? path.join(root, 'demo.html') : path.join(root, 'dist', 'demo.html')));
const read = (p) => fs.readFileSync(path.join(client, p), 'utf8');
const demoApi = fs.readFileSync(path.join(root, 'scripts', 'demo-api.js'), 'utf8');

// The demo uses the same starter games and categories as the real server, so they are copied in
// from the server source instead of being typed out a second time.
const { STARTER_GAMES } = await import(pathToFileURL(path.join(root, 'server', 'src', 'games-data.js')));
const { CATEGORIES } = await import(pathToFileURL(path.join(root, 'server', 'src', 'migrations', '002_foundation.js')));
const sharedData = `(window.FS = window.FS || {}).starterGames = ${JSON.stringify(STARTER_GAMES)};
window.FS.categories = ${JSON.stringify(CATEGORIES)};`;

// Same order as the script tags in client/index.html.
const scripts = [
  'js/theme.js', 'js/ui.js', 'js/api.js', 'SHARED_DATA', 'DEMO_API',
  'js/pages/home.js', 'js/pages/intel.js', 'js/pages/vault.js', 'js/pages/creators.js', 'js/pages/browse.js',
  'js/pages/listing.js', 'js/pages/auth.js', 'js/pages/sell.js', 'js/pages/account.js', 'js/pages/admin.js',
  'js/pages/checkout.js', 'js/pages/info.js', 'js/main.js',
];
const js = scripts.map((p) => (p === 'DEMO_API' ? demoApi : p === 'SHARED_DATA' ? sharedData : read(p))).join('\n').replace(/<\/script/gi, '<\\/script');

// An artifact title is a short name. The standalone page keeps the full description in its title.
const pageTitle = standalone ? 'FileShelf: utilities for single-player PC games' : 'FileShelf';
const body = `<title>${pageTitle}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
${read('css/styles.css')}
</style>
<a class="skip" href="#content" data-skip>Skip to content</a>
<div id="header"></div>
<main id="content" tabindex="-1"><p class="wrap loading">Loading...</p></main>
<div id="footer"></div>
<script>window.FILESHELF = { demo: true };</script>
<script>
${js}
</script>
`;

// A complete page keeps the title, fonts and styles in <head>. The artifact version is just the content.
const splitAt = body.indexOf('<a class="skip"');
const html = standalone
  ? `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${body.slice(0, splitAt)}</head>
<body>
${body.slice(splitAt)}</body>
</html>
`
  : body;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
