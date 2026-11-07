const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validateRequest, validateSettings, defaultSettings, resolveRuntime, allowedFile, validateRecording, isWithin, canonicalAudioFile, playableAudioFile } = require('../src/electron/guards.cjs');
const { LineProtocol, runPythonWorker, stopProcessTree } = require('../src/electron/worker.cjs');
const { JobQueue } = require('../src/electron/queue.cjs');
const { parseCsv, readVoiceLibrary } = require('../src/electron/library.cjs');
const { StateStore } = require('../src/electron/state.cjs');
const { parseByteRange, audioResponse } = require('../src/electron/audio.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const tts = { type: 'tts', text: '测试语音', instruct: '中年女性，中低音，温和，清晰吐字，语速适中。', language: 'Chinese' };

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'qwen-studio-test-'));
  t.after(async () => {
    assert.ok(isWithin(os.tmpdir(), root) && path.basename(root).startsWith('qwen-studio-test-'));
    await fsp.rm(root, { recursive: true, force: true });
  });
  await Promise.all(['outputs/tts', 'voice_design', 'model', 'user-data'].map((directory) => fsp.mkdir(path.join(root, directory), { recursive: true })));
  return root;
}

function wav(samples = [10, -10]) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => buffer.writeInt16LE(value, 44 + index * 2));
  return buffer;
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 31415; child.exitCode = null;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}

function deferredWorker() {
  let resolve, reject;
  const worker = { promise: new Promise((done, fail) => { resolve = done; reject = fail; }), cancelled: 0, cancel() { this.cancelled++; }, resolve: (value) => resolve(value), reject: (error) => reject(error) };
  return worker;
}

test('validates text, languages, size limits and separate runtime settings', () => {
  assert.equal(validateRequest({ ...tts, text: '  中文  ' }).text, '中文');
  assert.throws(() => validateRequest({ ...tts, instruct: '' }), /不能为空/);
  assert.throws(() => validateRequest({ ...tts, language: 'Auto' }), /合成语言/);
  assert.throws(() => validateRequest({ ...tts, text: '字'.repeat(6001) }), /6000/);
  assert.throws(() => validateRequest({ type: 'ocr' }), /仅支持/);
  const settings = defaultSettings(process.cwd());
  assert.equal(settings.asrModel, 'model/GLM-ASR-Nano-2512');
  assert.ok(resolveRuntime(process.cwd(), settings, 'tts').python.includes('.venv-tts'));
  assert.ok(resolveRuntime(process.cwd(), settings, 'asr').python.includes('.venv-asr'));
  assert.throws(() => validateSettings({ ...settings, gpuIndex: '-1' }), /GPU/);
  assert.throws(() => validateSettings({ ...settings, command: 'ignored' }), /不支持/);
});

test('requires an existing supported ASR file without modifying its contents', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'input.wav');
  const bytes = wav();
  await fsp.writeFile(source, bytes);
  assert.equal(validateRequest({ type: 'asr', audioPath: source }).audioPath, source);
  assert.deepEqual(await fsp.readFile(source), bytes);
  assert.throws(() => validateRequest({ type: 'asr', audioPath: 'input.wav' }), /请选择/);
  assert.throws(() => validateRequest({ type: 'asr', audioPath: path.join(root, 'missing.wav') }), /不存在/);
  assert.throws(() => validateRequest({ type: 'asr', audioPath: path.join(root, 'input.mp3') }), /WAV/);
});

test('guards canonical media and exports against traversal, sibling prefixes and junction escapes', async (t) => {
  const root = await fixture(t);
  const audio = path.join(root, 'outputs', 'tts', 'a.wav');
  await fsp.writeFile(audio, wav());
  await fsp.writeFile(path.join(root, 'model', 'secret.wav'), wav());
  assert.equal(await allowedFile(root, audio, { audioOnly: true }), await fsp.realpath(audio));
  await assert.rejects(allowedFile(root, path.join(root, 'outputs', '..', 'model', 'secret.wav')), /只能打开/);
  await fsp.mkdir(path.join(root, 'outputs-other'));
  await fsp.writeFile(path.join(root, 'outputs-other', 'outside.wav'), wav());
  await assert.rejects(allowedFile(root, path.join(root, 'outputs-other', 'outside.wav')), /只能打开/);
  const link = path.join(root, 'outputs', 'escaped');
  await fsp.symlink(path.join(root, 'model'), link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(allowedFile(root, path.join(link, 'secret.wav')), /只能打开/);
  await assert.rejects(allowedFile(root, path.join(root, 'outputs')), /请选择一个文件/);
});

test('recordings accept PCM16 WAV and reject truncated or forged payloads', () => {
  const bytes = wav();
  assert.deepEqual(validateRecording(bytes), bytes);
  assert.throws(() => validateRecording(new Uint8Array(48)), /完整/);
  assert.throws(() => validateRecording(bytes.subarray(0, bytes.length - 1)), /完整/);
  const invalid = Buffer.from(bytes); invalid.writeUInt16LE(3, 20);
  assert.throws(() => validateRecording(invalid), /16 位 PCM/);
  const empty = wav([]);
  assert.throws(() => validateRecording(empty), /为空/);
  assert.throws(() => validateRecording({ bytes }), /格式无效/);
});

test('only picker-selected external audio can play, while export/reveal guards remain restricted', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'imported.wav');
  const unselected = path.join(root, 'unselected.wav');
  await fsp.writeFile(source, wav());
  await fsp.writeFile(unselected, wav());
  const selected = new Set([await canonicalAudioFile(source)]);
  assert.equal(await playableAudioFile(root, source, selected), await fsp.realpath(source));
  await assert.rejects(playableAudioFile(root, unselected, selected), /只能打开/);
  await assert.rejects(playableAudioFile(root, source), /只能打开/);
  await assert.rejects(allowedFile(root, source), /只能打开/);
  await fsp.writeFile(source, '');
  await assert.rejects(playableAudioFile(root, source, selected), /为空/);
});

test('audio responses stream full bytes with finite-length headers and no bytes for HEAD', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'outputs', 'tts', 'audio.wav');
  const bytes = wav([100, 200, -300, 400]);
  await fsp.writeFile(file, bytes);
  const response = await audioResponse(file);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'audio/wav');
  assert.equal(response.headers.get('Content-Length'), String(bytes.length));
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const head = await audioResponse(file, { method: 'HEAD', range: 'bytes=0-3' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('audio responses serve inclusive byte ranges, suffixes and open ranges for seeking', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'outputs', 'tts', 'audio.wav');
  const bytes = wav([100, 200, -300, 400]);
  await fsp.writeFile(file, bytes);
  for (const [range, start, end] of [['bytes=0-3', 0, 3], ['bytes=44-', 44, bytes.length - 1], ['bytes=-4', bytes.length - 4, bytes.length - 1], ['bytes=0-99999', 0, bytes.length - 1]]) {
    const response = await audioResponse(file, { range });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/${bytes.length}`);
    assert.equal(response.headers.get('Content-Length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
  }
});

test('audio responses reject impossible, malformed and multiple ranges with 416', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'outputs', 'tts', 'audio.wav');
  const bytes = wav();
  await fsp.writeFile(file, bytes);
  for (const range of ['bytes=999-1000', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'items=0-3', 'bytes=999999999999999999999999-', 'garbage']) {
    const response = await audioResponse(file, { range });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), `bytes */${bytes.length}`);
    assert.equal(response.headers.get('Content-Length'), '0');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.deepEqual(parseByteRange('bytes=-999', bytes.length), { start: 0, end: bytes.length - 1 });
  assert.equal(parseByteRange('bytes=0-3', 0), null);
});

test('JSON lines retain split UTF-8 characters and handle library logs and final lines', () => {
  const events = [];
  const protocol = new LineProtocol((event) => events.push(event));
  const line = Buffer.from('{"type":"progress","message":"中文"}\n');
  const split = line.indexOf(Buffer.from('中')) + 1;
  protocol.push(line.subarray(0, split));
  protocol.push(line.subarray(split));
  protocol.push(Buffer.from('模型初始化\n{"type":"result","result":{"text":"末行"}}'));
  protocol.end();
  assert.equal(events[0].message, '中文');
  assert.equal(events[1].log, true);
  assert.deepEqual(events[2].result, { text: '末行' });
  assert.throws(() => new LineProtocol(() => {}).push(Buffer.alloc(2_000_001, 97)), /输出行过长/);
});

test('worker sends one JSON request without a shell and waits for successful process exit', async () => {
  const child = fakeChild();
  let options, command, args;
  const worker = runPythonWorker({ projectRoot: '/project', runtime: { python: '/runtime with spaces/python', modelPath: '/project/model/local', gpuIndex: '0' }, payload: { operation: 'tts', text: '中文' }, spawnProcess: (program, argv, configuration) => { command = program; args = argv; options = configuration; return child; }, platform: 'win32' });
  const input = child.stdin.read().toString('utf8');
  assert.equal(command, '/runtime with spaces/python');
  assert.deepEqual(args, ['-u', '-m', 'src.backend.worker']);
  assert.equal(options.shell, false);
  assert.equal(options.env.HF_HUB_OFFLINE, '1');
  assert.equal(options.env.PYTHONUTF8, '1');
  assert.equal(JSON.parse(input).model_path, '/project/model/local');
  child.stdout.write('{"type":"result","result":{"audioPath":"local.wav"}}\n');
  let finished = false; worker.promise.then(() => { finished = true; });
  await tick(); assert.equal(finished, false);
  child.exitCode = 0; child.emit('close', 0);
  assert.deepEqual(await worker.promise, { audioPath: 'local.wav' });
});

test('worker rejects reported errors and cannot treat a nonzero exit as success', async () => {
  for (const scenario of ['reported', 'nonzero', 'missing']) {
    const child = fakeChild();
    const worker = runPythonWorker({ projectRoot: '/project', runtime: { python: 'python', modelPath: 'model', gpuIndex: '0' }, payload: { operation: 'asr' }, spawnProcess: () => child, platform: 'win32' });
    if (scenario === 'reported') child.stdout.write('{"type":"error","message":"显存不足"}\n');
    else if (scenario === 'nonzero') child.stdout.write('{"type":"result","result":{}}\n');
    const code = scenario === 'missing' ? 0 : 1;
    child.exitCode = code; child.emit('close', code);
    await assert.rejects(worker.promise, scenario === 'reported' ? /显存不足/ : scenario === 'nonzero' ? /代码 1/ : /未返回结果/);
  }
});

test('health sends the selected runtime model and GPU independently for each interpreter', async () => {
  for (const kind of ['tts', 'asr']) {
    const child = fakeChild();
    const runtime = { python: `${kind}-python`, modelPath: `/custom/${kind}-model`, gpuIndex: '2' };
    const worker = runPythonWorker({ projectRoot: '/project', runtime, payload: { operation: 'health', kind }, spawnProcess: () => child, platform: 'win32' });
    const request = JSON.parse(child.stdin.read().toString('utf8'));
    assert.equal(request.operation, 'health');
    assert.equal(request.kind, kind);
    assert.equal(request.model_path, runtime.modelPath);
    assert.equal(request.gpu_index, '2');
    child.stdout.write('{"type":"result","result":{"ready":true}}\n');
    child.exitCode = 0; child.emit('close', 0);
    assert.equal((await worker.promise).ready, true);
  }
});

test('Windows cancellation kills the process tree using isolated taskkill arguments', () => {
  const child = fakeChild();
  let invocation;
  stopProcessTree(child, (command, args, options) => { invocation = { command, args, options }; return new EventEmitter(); }, 'win32');
  assert.equal(invocation.command, 'taskkill');
  assert.deepEqual(invocation.args, ['/PID', '31415', '/T', '/F']);
  assert.equal(invocation.options.shell, false);
});

test('TTS and ASR share a serial queue and progress/results update public job snapshots', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'input.wav'); await fsp.writeFile(source, wav());
  const runs = [];
  const queue = new JobQueue({ run: (job, event) => { const worker = deferredWorker(); runs.push({ job, event, worker }); return worker; } });
  const first = queue.submit(tts);
  const second = queue.submit({ type: 'asr', audioPath: source });
  await tick();
  assert.equal(runs.length, 1);
  assert.equal(queue.list().find((job) => job.id === second.id).status, 'queued');
  runs[0].event({ type: 'progress', message: '开始合成', percent: 30 });
  assert.equal(queue.list().find((job) => job.id === first.id).progress.percent, 30);
  runs[0].worker.resolve({ text: '完成' }); await tick();
  assert.equal(runs.length, 2);
  assert.equal(queue.list().find((job) => job.id === first.id).status, 'completed');
  runs[1].worker.resolve({ text: '识别结果' }); await tick();
  assert.equal(queue.list().find((job) => job.id === second.id).result.text, '识别结果');
});

test('cancellation holds the GPU slot until worker exit and queued cancellation starts no worker', async () => {
  const workers = [];
  const queue = new JobQueue({ run: () => { const worker = deferredWorker(); workers.push(worker); return worker; } });
  const first = queue.submit(tts), second = queue.submit(tts), third = queue.submit(tts);
  await tick();
  queue.cancel(first.id); queue.cancel(third.id); await tick();
  assert.equal(workers[0].cancelled, 1);
  assert.equal(workers.length, 1);
  assert.equal(queue.list().find((job) => job.id === third.id).status, 'cancelled');
  workers[0].reject(new Error('进程已退出')); await tick();
  assert.equal(workers.length, 2);
  assert.equal(queue.list().find((job) => job.id === second.id).status, 'running');
  workers[1].resolve({}); await tick();
  assert.equal(workers.length, 2);
  assert.equal(queue.list().find((job) => job.id === first.id).status, 'cancelled');
});

test('startup interrupts unfinished history and shutdown does not restart queued inference', async () => {
  let runs = 0;
  const queue = new JobQueue({ savedJobs: [{ id: 'past', type: 'tts', status: 'running' }], run: () => { runs++; return deferredWorker(); } });
  assert.equal(queue.list()[0].status, 'interrupted');
  queue.submit(tts);
  await queue.shutdown(); await tick();
  assert.equal(runs, 0);
  assert.equal(queue.list()[0].status, 'interrupted');
  assert.throws(() => queue.submit(tts), /退出/);
});

test('CSV library supports BOM, quoted multiline prompts and both old/new indexed voices', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(parseCsv('\uFEFFid,name\r\nx,"名字,含逗号"\r\ny,"第一行\n第二行"'), [{ id: 'x', name: '名字,含逗号' }, { id: 'y', name: '第一行\n第二行' }]);
  for (const [folder, id] of [['voice_design', 'old'], ['outputs/tts', 'new']]) {
    await fsp.writeFile(path.join(root, folder, `${id}.wav`), wav());
    await fsp.writeFile(path.join(root, folder, `${id}_prompt.txt`), '清晰\n柔和');
    await fsp.writeFile(path.join(root, folder, `${id}_text.txt`), '测试文本');
    await fsp.writeFile(path.join(root, folder, 'voice_library.csv'), `\uFEFFid,name,audio_file,prompt_file,text_file,duration_seconds\n${id},${id},${id}.wav,${id}_prompt.txt,${id}_text.txt,0.5\n`);
  }
  const voices = await readVoiceLibrary(root);
  assert.deepEqual(voices.map((voice) => voice.id), ['old', 'new']);
  assert.ok(voices.every((voice) => voice.audioPath && voice.instruct === '清晰\n柔和' && voice.durationSeconds === 0.5));
});

test('corrupted state is preserved before default state is written and settings roundtrip atomically', async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, 'user-data');
  const original = '{broken-json';
  await fsp.writeFile(path.join(directory, 'studio-state.json'), original);
  const store = new StateStore(directory, root);
  assert.ok(store.warning);
  store.jobs([]);
  const backups = (await fsp.readdir(directory)).filter((name) => name.includes('.invalid-'));
  assert.equal(backups.length, 1);
  assert.equal(await fsp.readFile(path.join(directory, backups[0]), 'utf8'), original);
  store.settings({ ...store.settings(), gpuIndex: '2' });
  assert.equal(new StateStore(directory, root).settings().gpuIndex, '2');
  assert.equal(fs.existsSync(path.join(directory, 'studio-state.json.tmp')), false);
});
