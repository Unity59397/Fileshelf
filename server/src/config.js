import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_EXTENSIONS =
  'zip,7z,rar,gz,tar,pdf,txt,md,json,csv,xlsx,docx,pptx,png,jpg,jpeg,webp';

// All settings come from environment variables. See the README for the full list.
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  const dataDir = path.resolve(env.DATA_DIR || path.join(here, '..', 'data'));
  // "off" means every listing is free. Paid listings stay unavailable until a payment provider is set up and tested.
  const payments = env.PAYMENTS || (env.STRIPE_SECRET_KEY ? 'stripe' : 'off');

  if (!['off', 'mock', 'stripe'].includes(payments)) {
    throw new Error('PAYMENTS must be "off", "mock" or "stripe".');
  }
  if (payments === 'stripe' && !env.STRIPE_SECRET_KEY) {
    throw new Error('Set STRIPE_SECRET_KEY to use Stripe payments.');
  }
  if (production) {
    if (!env.APP_SECRET || env.APP_SECRET.length < 32) {
      throw new Error('Set APP_SECRET to a random string of at least 32 characters.');
    }
    // The example file ships a placeholder. Starting with it would sign download links with a public value.
    if (/^change-me/i.test(env.APP_SECRET)) {
      throw new Error('APP_SECRET is still the placeholder from .env.example. Replace it with a random string.');
    }
    if (payments === 'mock') {
      throw new Error('Test payments cannot run in production. Use PAYMENTS=off, or set STRIPE_SECRET_KEY.');
    }
    if (!env.BASE_URL || !env.BASE_URL.startsWith('https://')) {
      throw new Error('Set BASE_URL to your public https address.');
    }
  }

  return {
    production,
    port,
    baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dataDir,
    dbFile: env.DB_FILE || path.join(dataDir, 'fileshelf.db'),
    storageDir: path.join(dataDir, 'storage'),
    tmpDir: path.join(dataDir, 'tmp'),
    clientDir: path.resolve(env.CLIENT_DIR || path.join(here, '..', '..', 'client')),
    secret: env.APP_SECRET || 'dev-only-secret-change-me-before-going-live',
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    // Shown on the Help page and in the footer. Leave empty if there is no public contact address yet.
    contactEmail: (env.CONTACT_EMAIL || '').trim(),
    payments,
    stripeKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    // Platform fee in basis points. 1000 = 10%.
    feeBps: Number(env.PLATFORM_FEE_BPS ?? 1000),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || 200) * 1024 * 1024,
    maxImageBytes: Number(env.MAX_IMAGE_MB || 5) * 1024 * 1024,
    maxImages: 6,
    minPricePence: 99,
    maxPricePence: 50000,
    allowedExtensions: (env.ALLOWED_EXTENSIONS || DEFAULT_EXTENSIONS)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    // Optional virus scan command, for example "clamscan --no-summary". The file path is added at the end.
    // Exit code 0 = clean, 1 = infected, anything else = scan failed.
    scanCommand: env.SCAN_COMMAND || '',
    trustProxy: env.TRUST_PROXY === '1',
    downloadLinkSeconds: 300,
    sessionDays: 14,
  };
}
