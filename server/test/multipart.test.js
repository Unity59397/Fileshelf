import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { parseMultipart } from '../src/multipart.js';

const BOUNDARY = '----testboundary123';

function body(parts) {
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if (p.filename !== undefined) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: application/zip\r\n\r\n`));
      chunks.push(p.data);
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`));
      chunks.push(Buffer.from(p.value));
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

function reqOf(buffer, chunkSize) {
  const chunks = [];
  for (let i = 0; i < buffer.length; i += chunkSize) chunks.push(buffer.subarray(i, i + chunkSize));
  return Object.assign(Readable.from(chunks, { objectMode: false }), {
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));

test('parses fields and binary files whatever the chunk size', async () => {
  // Binary data that contains almost-boundaries, to catch bugs at chunk edges.
  const tricky = Buffer.concat([
    crypto.randomBytes(5000),
    Buffer.from(`\r\n--${BOUNDARY.slice(0, -3)}`),
    crypto.randomBytes(3000),
    Buffer.from(`\r\n--`),
    crypto.randomBytes(100),
  ]);
  const payload = body([
    { name: 'title', value: 'Hello world' },
    { name: 'paid_file', filename: 'a.zip', data: tricky },
    { name: 'note', value: 'multi\r\nline' },
    { name: 'free_file', filename: '', data: Buffer.alloc(0) },
  ]);
  for (const size of [1, 2, 3, 7, 19, 64, 1000, 65536]) {
    const dir = tmp();
    const { fields, files } = await parseMultipart(reqOf(payload, size), { tmpDir: dir, maxFileBytes: 1e6 });
    assert.equal(fields.title, 'Hello world');
    assert.equal(fields.note, 'multi\r\nline');
    assert.equal(files.length, 1, `chunk size ${size}`);
    assert.equal(files[0].filename, 'a.zip');
    assert.equal(files[0].size, tricky.length);
    assert.ok(fs.readFileSync(files[0].path).equals(tricky), `file bytes match at chunk size ${size}`);
    fs.rmSync(dir, { recursive: true });
  }
});

test('rejects files over the size limit and cleans up', async () => {
  const dir = tmp();
  const payload = body([{ name: 'paid_file', filename: 'big.zip', data: Buffer.alloc(5000, 1) }]);
  await assert.rejects(parseMultipart(reqOf(payload, 512), { tmpDir: dir, maxFileBytes: 1000 }), (e) => e.status === 413);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('rejects a body that ends early and cleans up', async () => {
  const dir = tmp();
  const full = body([{ name: 'paid_file', filename: 'a.zip', data: Buffer.alloc(3000, 2) }]);
  await assert.rejects(parseMultipart(reqOf(full.subarray(0, 1500), 256), { tmpDir: dir, maxFileBytes: 1e6 }), (e) => e.status === 400);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('rejects too many files', async () => {
  const dir = tmp();
  const parts = Array.from({ length: 4 }, (_, i) => ({ name: 'images', filename: `i${i}.png`, data: Buffer.from('x') }));
  await assert.rejects(parseMultipart(reqOf(body(parts), 100), { tmpDir: dir, maxFileBytes: 1e6, maxFiles: 3 }), (e) => e.status === 400);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});
