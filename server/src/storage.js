import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { httpError } from './http.js';

const execFileP = promisify(execFile);

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export const extOf = (name) => path.extname(name).slice(1).toLowerCase();

// The name shown to buyers. The file on disk never uses it.
export function safeName(name) {
  const base = path.basename(String(name).replace(/\\/g, '/'));
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '_').trim().slice(0, 120);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
}

function sniffImage(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function scan(cfg, file) {
  if (!cfg.scanCommand) return 'unscanned';
  const [cmd, ...args] = cfg.scanCommand.split(/\s+/);
  try {
    await execFileP(cmd, [...args, file], { timeout: 120000 });
    return 'clean';
  } catch (err) {
    if (err.code === 1) throw httpError(422, 'A file was flagged by the virus scan and was not accepted.');
    console.error('Virus scan failed:', err.message);
    throw httpError(503, 'The virus scan is unavailable right now. Try again later.');
  }
}

// Validate an uploaded temp file, scan it, and move it into private storage. Returns the files row id.
export async function storeUpload({ cfg, db }, upload, kind, ownerId) {
  const name = safeName(upload.filename);
  const ext = extOf(name);
  let mime = 'application/octet-stream';

  if (kind === 'image') {
    if (!IMAGE_TYPES[ext]) throw httpError(400, 'Images must be PNG, JPG or WebP.');
    if (upload.size > cfg.maxImageBytes) {
      throw httpError(413, `Images must be smaller than ${Math.round(cfg.maxImageBytes / 1024 / 1024)} MB.`);
    }
    mime = sniffImage(upload.path);
    if (!mime) throw httpError(400, 'One of the images is not a real PNG, JPG or WebP file.');
  } else {
    if (!cfg.allowedExtensions.includes(ext)) {
      throw httpError(400, `".${ext || 'unknown'}" files are not accepted. Allowed: ${cfg.allowedExtensions.join(', ')}.`);
    }
    if (upload.size === 0) throw httpError(400, 'That file is empty.');
  }

  const scanStatus = await scan(cfg, upload.path);
  const sha256 = await hashFile(upload.path);
  const id = crypto.randomUUID();
  const rel = path.join(kind, id);
  const dest = path.join(cfg.storageDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(upload.path, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(upload.path, dest);
    fs.rmSync(upload.path, { force: true });
  }

  db.prepare(
    `INSERT INTO files (id, owner_id, kind, orig_name, stored_path, size, sha256, mime, scan_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, ownerId, kind, name, rel, upload.size, sha256, mime, scanStatus, Date.now());
  return id;
}

export function removeTemp(files) {
  for (const f of files || []) fs.rmSync(f.path, { force: true });
}

export function removeStored(cfg, db, fileIds) {
  for (const id of fileIds) {
    const row = db.prepare('SELECT stored_path FROM files WHERE id = ?').get(id);
    if (row) fs.rmSync(path.join(cfg.storageDir, row.stored_path), { force: true });
    db.prepare('DELETE FROM files WHERE id = ?').run(id);
  }
}

export function filePath(cfg, row) {
  const full = path.resolve(cfg.storageDir, row.stored_path);
  if (!full.startsWith(path.resolve(cfg.storageDir) + path.sep)) throw httpError(404, 'File not found.');
  return full;
}

// Download links are signed and expire. The link carries which file and which user it was made for.
export function signToken(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(secret, token) {
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
