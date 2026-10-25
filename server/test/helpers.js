import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { resetRateLimits } from '../src/http.js';

// Starts the real app on a random port with its own temporary data folder.
export async function startTestApp(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileshelf-test-'));
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    CLIENT_DIR: path.join(dataDir, 'client'),
    ADMIN_EMAIL: 'admin@fileshelf.test',
    APP_SECRET: 'test-secret-test-secret-test-secret-1234',
    // Most tests exercise paid listings, so they use test payments. Pass PAYMENTS: 'off' to test the default.
    PAYMENTS: 'mock',
    ...extraEnv,
  });
  fs.mkdirSync(cfg.clientDir, { recursive: true });
  fs.writeFileSync(path.join(cfg.clientDir, 'index.html'), '<!doctype html><title>test</title>');
  resetRateLimits();
  const app = createApp(cfg);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    ...app,
    cfg,
    base,
    async stop() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// A tiny browser stand-in that keeps the session cookie between requests.
export function makeClient(base) {
  let cookie = '';
  async function request(method, url, { json, form, headers = {}, redirect = 'manual' } = {}) {
    const init = { method, headers: { ...headers }, redirect };
    if (cookie) init.headers.cookie = cookie;
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    if (form) init.body = form;
    const res = await fetch(base + url, init);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body, headers: res.headers };
  }
  return {
    get: (u, o) => request('GET', u, o),
    post: (u, o) => request('POST', u, o),
    patch: (u, o) => request('PATCH', u, o),
    delete: (u, o) => request('DELETE', u, o),
  };
}

export const PASSWORD = 'correct-horse-battery';

export async function signUp(base, username, email) {
  const c = makeClient(base);
  const res = await c.post('/api/auth/signup', { json: { username, email: email || `${username}@example.test`, password: PASSWORD } });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  return c;
}

// Signs up, then sets up a creator profile so the account can publish.
export async function signUpCreator(base, username, email) {
  const c = await signUp(base, username, email);
  const res = await c.post('/api/me/creator', { json: { display_name: username, bio: '' } });
  if (res.status !== 200) throw new Error(`creator setup failed: ${JSON.stringify(res.body)}`);
  return c;
}

export function listingForm({ title = 'Save backup helper', price = '12.50', game = 'stardew-valley', category = 'save-tools', file, free, images = [], extra = {} } = {}) {
  const form = new FormData();
  form.set('title', title);
  form.set('summary', 'Backs up save files before each play session.');
  form.set('description', 'Copies the save folder to a dated backup when the game starts.');
  form.set('features', 'Dated backups\nOne-click restore');
  form.set('version', '1.0');
  form.set('price', price);
  form.set('game', game);
  form.set('category', category);
  form.set('agree', 'yes');
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  if (file) form.set('paid_file', new Blob([file.data]), file.name);
  if (free) form.set('free_file', new Blob([free.data]), free.name);
  for (const img of images) form.append('images', new Blob([img.data]), img.name);
  return form;
}

export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082',
  'hex',
);
