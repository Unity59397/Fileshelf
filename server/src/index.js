import { loadConfig } from './config.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const { server, close, db } = createApp(cfg);

server.listen(cfg.port, () => {
  console.log(`FileShelf is running at ${cfg.baseUrl}`);
  if (cfg.payments === 'mock') {
    console.log('Payments are in TEST mode: checkout is simulated and no money moves.');
  }
  const hasAdmin = !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!hasAdmin && !cfg.adminEmail) {
    console.log('There is no admin yet, so nobody can review listings. Set ADMIN_EMAIL, then sign up with that email.');
  } else if (!hasAdmin) {
    console.log(`There is no admin yet. The first account to sign up with ${cfg.adminEmail} becomes the admin.`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    close().then(() => process.exit(0));
  });
}
