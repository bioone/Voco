const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readWavMetadata, validateFixtureBytes, prepareFixture } = require('../scripts/prepare-asr-fixtures.cjs');

function syntheticWav() {
  const frames = 8;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  bytes.writeInt16LE(1000, 44);
  const fixture = {
    id: 'synthetic', filename: 'synthetic.wav', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wav: { format_tag: 1, sample_rate: 16000, channels: 1, bits_per_sample: 16, frames: 8, duration_seconds: 0.0005 },
  };
  return { bytes, fixture };
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-asr-fixtures-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('qwen-asr-fixtures-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('PCM metadata and manifest values are verified independently of model inference', () => {
  const { bytes, fixture } = syntheticWav();
  assert.deepEqual(readWavMetadata(bytes), fixture.wav);
  assert.deepEqual(validateFixtureBytes(bytes, fixture), fixture.wav);
});

test('empty, truncated and hash-corrupted fixtures are rejected', () => {
  const { bytes, fixture } = syntheticWav();
  assert.throws(() => validateFixtureBytes(Buffer.alloc(0), fixture), /empty/);
  assert.throws(() => validateFixtureBytes(bytes.subarray(0, 20), fixture), /byte length/);
  const corrupted = Buffer.from(bytes); corrupted[44] ^= 1;
  assert.throws(() => validateFixtureBytes(corrupted, fixture), /SHA-256/);
});

test('wrong metadata is rejected even when the hash and byte length match', () => {
  const { bytes, fixture } = syntheticWav();
  for (const [key, value] of Object.entries({ format_tag: 3, sample_rate: 48000, channels: 2, bits_per_sample: 24, frames: 99, duration_seconds: 1 })) {
    assert.throws(() => validateFixtureBytes(bytes, { ...fixture, wav: { ...fixture.wav, [key]: value } }), /mismatch/);
  }
});

test('invalid RIFF lengths, PCM alignment and empty audio are rejected', () => {
  const { bytes } = syntheticWav();
  const wrongLength = Buffer.from(bytes); wrongLength.writeUInt32LE(1, 4);
  assert.throws(() => readWavMetadata(wrongLength), /RIFF length/);
  const wrongAlignment = Buffer.from(bytes); wrongAlignment.writeUInt16LE(4, 32);
  assert.throws(() => readWavMetadata(wrongAlignment), /alignment/);
  const empty = Buffer.from(bytes.subarray(0, 44)); empty.writeUInt32LE(36, 4); empty.writeUInt32LE(0, 40);
  assert.throws(() => readWavMetadata(empty), /no audio/);
});

test('default preparation is offline and leaves a missing cache untouched', async (t) => {
  const directory = await temporaryDirectory(t);
  const { fixture } = syntheticWav();
  let called = false;
  await assert.rejects(prepareFixture(path.join(directory, 'absent'), fixture, { fetchBytes: async () => { called = true; } }), /Missing official fixture/);
  assert.equal(called, false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('verified bytes are installed, and a valid cache skips downloading', async (t) => {
  const directory = await temporaryDirectory(t);
  const { bytes, fixture } = syntheticWav();
  const prepared = await prepareFixture(directory, fixture, { download: true, fetchBytes: async () => bytes });
  assert.equal(prepared.status, 'prepared');
  assert.deepEqual(await fs.readFile(prepared.file), bytes);
  const cached = await prepareFixture(directory, fixture, { download: true, fetchBytes: async () => { assert.fail('valid cache must not download'); } });
  assert.equal(cached.status, 'cached');
  assert.deepEqual(await fs.readdir(directory), [fixture.filename]);
});

test('existing bad cache is never replaced, even with download enabled', async (t) => {
  const directory = await temporaryDirectory(t);
  const { bytes, fixture } = syntheticWav();
  const corrupt = Buffer.from(bytes); corrupt[44] ^= 1;
  const file = path.join(directory, fixture.filename);
  await fs.writeFile(file, corrupt);
  await assert.rejects(prepareFixture(directory, fixture, { download: true, fetchBytes: async () => { assert.fail('bad cache must not download'); } }), /left unchanged.*SHA-256/);
  assert.deepEqual(await fs.readFile(file), corrupt);
});

test('invalid downloads and interrupted downloads leave no partial files', async (t) => {
  const directory = await temporaryDirectory(t);
  const { bytes, fixture } = syntheticWav();
  const corrupt = Buffer.from(bytes); corrupt[44] ^= 1;
  await assert.rejects(prepareFixture(directory, fixture, { download: true, fetchBytes: async () => corrupt }), /SHA-256/);
  await assert.rejects(prepareFixture(directory, fixture, { download: true, fetchBytes: async () => { throw new Error('network interrupted'); } }), /network interrupted/);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('concurrent preparations install one verified file without overwriting it or retaining temporary files', async (t) => {
  const directory = await temporaryDirectory(t);
  const { bytes, fixture } = syntheticWav();
  const results = await Promise.all([1, 2].map(() => prepareFixture(directory, fixture, { download: true, fetchBytes: async () => bytes })));
  assert.deepEqual(results.map((result) => result.status).sort(), ['cached', 'prepared']);
  assert.deepEqual(await fs.readFile(path.join(directory, fixture.filename)), bytes);
  assert.deepEqual(await fs.readdir(directory), [fixture.filename]);
});

test('a destination created during download is preserved and failed finalization cleans its temporary file', async (t) => {
  const directory = await temporaryDirectory(t);
  const { bytes, fixture } = syntheticWav();
  const conflicting = Buffer.from(bytes); conflicting[44] ^= 1;
  const file = path.join(directory, fixture.filename);
  await assert.rejects(prepareFixture(directory, fixture, { download: true, fetchBytes: async () => {
    await fs.writeFile(file, conflicting, { flag: 'wx' });
    return bytes;
  } }), /left unchanged.*SHA-256/);
  assert.deepEqual(await fs.readFile(file), conflicting);
  assert.deepEqual(await fs.readdir(directory), [fixture.filename]);
});

test('unsafe cache filenames are rejected before reading or downloading', async (t) => {
  const directory = await temporaryDirectory(t);
  const { fixture } = syntheticWav();
  for (const filename of ['../escape.wav', '..\\escape.wav', '/absolute.wav', 'C:\\escape.wav']) {
    await assert.rejects(prepareFixture(directory, { ...fixture, filename }, { download: true, fetchBytes: async () => { assert.fail('unsafe name must not download'); } }), /Unsafe/);
  }
});
