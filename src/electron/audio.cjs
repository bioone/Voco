const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const CONTENT_TYPES = { '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg' };

function parseByteRange(value, size) {
  if (typeof value !== 'string' || value.length > 128 || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) {
    if (last <= 0) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) };
}

async function audioResponse(file, { method = 'GET', range = null } = {}) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0) throw new Error('音频文件为空或无效。');
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!contentType) throw new Error('音频格式不受支持。');
  const headers = new Headers({ 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size) });
  if (!['GET', 'HEAD'].includes(method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Length': '0' } });
  // HTTP Range applies to GET. HEAD returns the same full representation headers without bytes.
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  let selected = { start: 0, end: stat.size - 1 };
  let status = 200;
  if (range !== null) {
    selected = parseByteRange(range, stat.size);
    if (!selected) {
      headers.set('Content-Range', `bytes */${stat.size}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${selected.start}-${selected.end}/${stat.size}`);
    headers.set('Content-Length', String(selected.end - selected.start + 1));
  }
  const stream = fs.createReadStream(file, selected);
  return new Response(Readable.toWeb(stream), { status, headers });
}

module.exports = { parseByteRange, audioResponse };
