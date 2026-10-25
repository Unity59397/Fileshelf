import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { httpError } from './http.js';

// Streams a multipart/form-data request to disk. Files never sit in memory, so large uploads are fine.
// Returns { fields, files }. Each file is { field, filename, mime, path, size } and lives in tmpDir
// until the caller moves it. If parsing fails, every temporary file is removed before the error is thrown.
export async function parseMultipart(req, opts) {
  const {
    tmpDir,
    maxFileBytes,
    maxFiles = 8,
    maxFields = 30,
    maxFieldBytes = 64 * 1024,
  } = opts;

  const type = req.headers['content-type'] || '';
  const m = /^multipart\/form-data;.*?boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!m) throw httpError(415, 'Send the form as multipart/form-data.');
  const boundary = (m[1] || m[2]).trim();
  if (!boundary || boundary.length > 70) throw httpError(400, 'The upload is not valid.');

  fs.mkdirSync(tmpDir, { recursive: true });
  const delim = Buffer.from('\r\n--' + boundary);
  const fields = {};
  const files = [];
  let state = 'preamble';
  // A virtual CRLF in front lets the very first boundary match the same pattern as all the others.
  let buf = Buffer.from('\r\n');
  let part = null;
  let fieldCount = 0;

  const limitMb = Math.round(maxFileBytes / 1024 / 1024);

  function startPart(headerText) {
    const lines = headerText.split('\r\n');
    let name = null;
    let filename;
    let mime = 'application/octet-stream';
    for (const line of lines) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).trim().toLowerCase();
      const value = line.slice(i + 1).trim();
      if (key === 'content-disposition') {
        const n = /[; ]name="((?:[^"\\]|\\.)*)"/i.exec(value);
        const f = /[; ]filename="((?:[^"\\]|\\.)*)"/i.exec(value);
        if (n) name = n[1];
        if (f) filename = f[1];
      } else if (key === 'content-type') {
        mime = value.toLowerCase();
      }
    }
    if (name === null) throw httpError(400, 'The upload is not valid.');
    const p = { name, filename, mime, bytes: 0, chunks: [] };
    if (filename !== undefined) {
      if (files.length >= maxFiles) throw httpError(400, `You can upload at most ${maxFiles} files at once.`);
      p.path = path.join(tmpDir, crypto.randomUUID());
      p.stream = fs.createWriteStream(p.path);
      p.stream.on('error', () => {});
    } else {
      fieldCount += 1;
      if (fieldCount > maxFields) throw httpError(400, 'The form has too many fields.');
    }
    return p;
  }

  async function writePart(data) {
    if (!data.length) return;
    part.bytes += data.length;
    if (part.stream) {
      if (part.bytes > maxFileBytes) throw httpError(413, `A file is larger than the ${limitMb} MB limit.`);
      if (!part.stream.write(data)) await once(part.stream, 'drain');
    } else {
      if (part.bytes > maxFieldBytes) throw httpError(400, 'A form field is too long.');
      part.chunks.push(Buffer.from(data));
    }
  }

  async function endPart() {
    if (part.stream) {
      part.stream.end();
      await once(part.stream, 'finish');
      if (part.filename === '' && part.bytes === 0) {
        fs.rmSync(part.path, { force: true }); // the browser sends an empty part when no file was chosen
      } else {
        files.push({
          field: part.name,
          filename: part.filename,
          mime: part.mime,
          path: part.path,
          size: part.bytes,
        });
      }
    } else {
      fields[part.name] = Buffer.concat(part.chunks).toString('utf8');
    }
    part = null;
  }

  try {
    for await (const chunk of req) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let again = true;
      while (again) {
        again = false;
        if (state === 'preamble') {
          const i = buf.indexOf(delim);
          if (i >= 0) {
            buf = buf.subarray(i + delim.length);
            state = 'afterDelim';
            again = true;
          } else if (buf.length >= delim.length) {
            buf = buf.subarray(buf.length - delim.length + 1);
          }
        } else if (state === 'afterDelim') {
          if (buf.length >= 2) {
            const t = buf.subarray(0, 2).toString('latin1');
            if (t === '--') {
              state = 'done';
              buf = Buffer.alloc(0);
            } else if (t === '\r\n') {
              buf = buf.subarray(2);
              state = 'headers';
              again = true;
            } else {
              throw httpError(400, 'The upload is not valid.');
            }
          }
        } else if (state === 'headers') {
          const i = buf.indexOf('\r\n\r\n');
          if (i >= 0) {
            part = startPart(buf.subarray(0, i).toString('utf8'));
            buf = buf.subarray(i + 4);
            state = 'body';
            again = true;
          } else if (buf.length > 8192) {
            throw httpError(400, 'The upload is not valid.');
          }
        } else if (state === 'body') {
          const i = buf.indexOf(delim);
          if (i >= 0) {
            await writePart(buf.subarray(0, i));
            await endPart();
            buf = buf.subarray(i + delim.length);
            state = 'afterDelim';
            again = true;
          } else if (buf.length >= delim.length) {
            const keep = delim.length - 1;
            await writePart(buf.subarray(0, buf.length - keep));
            buf = buf.subarray(buf.length - keep);
          }
        } else {
          buf = Buffer.alloc(0); // epilogue after the closing boundary
        }
      }
    }
    if (state !== 'done') throw httpError(400, 'The upload ended early. Try again.');
  } catch (err) {
    if (part && part.stream) part.stream.destroy();
    if (part && part.path) fs.rmSync(part.path, { force: true });
    for (const f of files) fs.rmSync(f.path, { force: true });
    throw err;
  }
  return { fields, files };
}
