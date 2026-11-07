const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { createHash, randomUUID } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'tests', 'fixtures', 'qwen3-asr', 'manifest.json');
const MAX_BYTES = 5 * 1024 * 1024;
const OFFICIAL_BASE = 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/';

function readWavMetadata(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44) throw new Error('WAV is empty or truncated.');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected a RIFF/WAVE file.');
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('WAV RIFF length does not match the file.');
  let format;
  let dataBytes;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated WAV chunk header.');
    const name = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error('Truncated WAV chunk data.');
    if (name === 'fmt ') {
      if (format || size < 16) throw new Error('Invalid or duplicate WAV format chunk.');
      format = {
        format_tag: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sample_rate: bytes.readUInt32LE(start + 4),
        byte_rate: bytes.readUInt32LE(start + 8),
        block_align: bytes.readUInt16LE(start + 12),
        bits_per_sample: bytes.readUInt16LE(start + 14),
      };
    } else if (name === 'data') {
      if (dataBytes !== undefined) throw new Error('Duplicate WAV data chunk.');
      dataBytes = size;
    }
    offset = end + (size % 2);
    if (offset > bytes.length) throw new Error('Missing WAV chunk padding.');
  }
  if (!format || dataBytes === undefined) throw new Error('WAV format or data chunk is missing.');
  if (format.format_tag !== 1 || ![8, 16, 24, 32].includes(format.bits_per_sample)) {
    throw new Error('Expected uncompressed integer PCM WAV.');
  }
  if (format.channels < 1 || format.sample_rate < 1 || dataBytes < 1) throw new Error('WAV contains no audio.');
  if (format.block_align !== format.channels * format.bits_per_sample / 8
      || format.byte_rate !== format.sample_rate * format.block_align
      || dataBytes % format.block_align !== 0) throw new Error('Invalid WAV frame alignment or byte rate.');
  const frames = dataBytes / format.block_align;
  return {
    format_tag: format.format_tag,
    sample_rate: format.sample_rate,
    channels: format.channels,
    bits_per_sample: format.bits_per_sample,
    frames,
    duration_seconds: frames / format.sample_rate,
  };
}

function validateFixtureBytes(bytes, fixture) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Fixture is empty.');
  if (bytes.length > MAX_BYTES || bytes.length !== fixture.bytes) throw new Error(`Fixture byte length mismatch: expected ${fixture.bytes}, got ${bytes.length}.`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== fixture.sha256) throw new Error(`Fixture SHA-256 mismatch for ${fixture.filename}.`);
  const wav = readWavMetadata(bytes);
  for (const key of ['format_tag', 'sample_rate', 'channels', 'bits_per_sample', 'frames']) {
    if (wav[key] !== fixture.wav?.[key]) throw new Error(`WAV ${key} mismatch: expected ${fixture.wav?.[key]}, got ${wav[key]}.`);
  }
  if (!Number.isFinite(fixture.wav?.duration_seconds)
      || Math.abs(wav.duration_seconds - fixture.wav.duration_seconds) > 1e-9) throw new Error('WAV duration mismatch.');
  return wav;
}

async function readCached(file, fixture) {
  let stat;
  try { stat = await fs.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Existing fixture is not a regular file: ${file}`);
  if (stat.size > MAX_BYTES || stat.size !== fixture.bytes) throw new Error(`Invalid existing fixture byte length; left unchanged: ${file}`);
  try {
    return validateFixtureBytes(await fs.readFile(file), fixture);
  } catch (error) {
    throw new Error(`Invalid existing fixture; left unchanged: ${file}. ${error.message}`);
  }
}

function downloadBytes(fixture) {
  return new Promise((resolve, reject) => {
    if (fixture.url !== OFFICIAL_BASE + fixture.filename) {
      reject(new Error('Only the fixed official Qwen sample URL is allowed.'));
      return;
    }
    const request = https.get(fixture.url, { headers: { 'User-Agent': 'qwenASR-fixture-preparation', 'Accept-Encoding': 'identity' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Official sample download returned HTTP ${response.statusCode}; redirects are not followed.`));
        return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length > MAX_BYTES || length > fixture.bytes) {
          response.destroy(new Error('Official sample exceeds its declared size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Official sample download was interrupted.')));
      response.on('end', () => resolve(Buffer.concat(chunks, length)));
    });
    const timer = setTimeout(() => request.destroy(new Error('Official sample download timed out after 30 seconds.')), 30000);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}

async function prepareFixture(cacheDirectory, fixture, { download = false, fetchBytes = downloadBytes } = {}) {
  if (!/^[a-z0-9_-]+\.wav$/i.test(fixture.filename)) throw new Error('Unsafe fixture filename.');
  const file = path.join(path.resolve(cacheDirectory), fixture.filename);
  const cached = await readCached(file, fixture);
  if (cached) return { id: fixture.id, status: 'cached', file, wav: cached };
  if (!download) throw new Error(`Missing official fixture: ${file}. Run node scripts/prepare-asr-fixtures.cjs --download to prepare it.`);

  const bytes = await fetchBytes(fixture);
  const wav = validateFixtureBytes(bytes, fixture);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${fixture.filename}.${randomUUID()}.part`);
  let ownsTemporary = false;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally { await handle.close(); }
    // A hard link atomically installs the verified file and refuses to replace
    // an existing destination. Both names are in the same cache directory.
    try { await fs.link(temporary, file); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const concurrent = await readCached(file, fixture);
      if (!concurrent) throw new Error(`Fixture disappeared during concurrent preparation: ${file}`);
      return { id: fixture.id, status: 'cached', file, wav: concurrent };
    }
    return { id: fixture.id, status: 'prepared', file, wav };
  } finally {
    if (ownsTemporary) await fs.unlink(temporary);
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/prepare-asr-fixtures.cjs [--download]\nDefault: verify cached official WAVs without network access.\n--download: fetch only missing samples; never replace existing files.');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--download')) throw new Error('Only --download or --help is supported.');
  const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  if (manifest.schema_version !== 1 || manifest.cache_directory !== 'outputs/test-fixtures/qwen3-asr'
      || manifest.max_download_bytes !== MAX_BYTES || manifest.fixtures?.length !== 2) throw new Error('Invalid official fixture manifest.');
  const names = new Set();
  for (const fixture of manifest.fixtures) {
    if (!['asr_zh.wav', 'asr_en.wav'].includes(fixture.filename) || names.has(fixture.filename)
        || fixture.url !== OFFICIAL_BASE + fixture.filename || !/^[a-f0-9]{64}$/.test(fixture.sha256)
        || !Number.isSafeInteger(fixture.bytes) || fixture.bytes < 44 || fixture.bytes > MAX_BYTES) throw new Error('Invalid official sample entry in manifest.');
    names.add(fixture.filename);
  }
  const cache = path.join(ROOT, manifest.cache_directory);
  for (const fixture of manifest.fixtures) {
    const result = await prepareFixture(cache, fixture, { download: args.includes('--download') });
    console.log(`${result.status}: ${fixture.id}, ${result.wav.sample_rate} Hz, ${result.wav.duration_seconds.toFixed(6)} s, ${result.file}`);
  }
  console.log('Official sample files verified. No model inference was performed.');
}

module.exports = { readWavMetadata, validateFixtureBytes, prepareFixture };

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
