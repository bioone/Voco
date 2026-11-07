const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { resolveApplicationPaths } = require('../src/electron/paths.cjs');
const { runPythonWorker } = require('../src/electron/worker.cjs');

async function fixture(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'qwen-packaged-paths-'));
  t.after(async () => {
    assert.ok(path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('qwen-packaged-paths-'));
    await fsp.rm(directory, { recursive: true, force: true });
  });
  const projectRoot = path.join(directory, 'external project');
  const resourcesPath = path.join(directory, 'software', 'resources');
  const backendRoot = path.join(resourcesPath, 'python');
  const appPath = path.join(resourcesPath, 'app');
  await Promise.all([path.join(projectRoot, 'model'), path.join(backendRoot, 'src', 'backend'), appPath].map((item) => fsp.mkdir(item, { recursive: true })));
  await fsp.writeFile(path.join(backendRoot, 'run_worker.py'), '');
  await fsp.writeFile(path.join(backendRoot, 'src', 'backend', 'worker.py'), '');
  const configFile = path.join(resourcesPath, 'runtime-location.json');
  await fsp.writeFile(configFile, JSON.stringify({ projectRoot: path.relative(resourcesPath, projectRoot) }));
  return { directory, projectRoot, resourcesPath, backendRoot, appPath, configFile };
}

test('development resolves renderer, Python and project paths without a packaged configuration', () => {
  const appPath = path.resolve('source checkout');
  const result = resolveApplicationPaths({ appPath, resourcesPath: 'irrelevant', isPackaged: false });
  assert.equal(result.projectRoot, appPath);
  assert.equal(result.rendererFile, path.join(appPath, 'dist', 'index.html'));
  assert.equal(result.backendRoot, undefined);
});

test('unpacked configuration keeps bundled code separate from external models and data', async (t) => {
  const inputs = await fixture(t);
  const result = resolveApplicationPaths({ ...inputs, isPackaged: true });
  assert.equal(result.projectRoot, inputs.projectRoot);
  assert.equal(result.backendRoot, inputs.backendRoot);
  assert.equal(result.rendererFile, path.join(inputs.appPath, 'dist', 'index.html'));
  assert.equal(result.configFile, inputs.configFile);
  assert.notEqual(result.projectRoot, result.appRoot);
});

test('broken runtime configuration gives its location and repair instructions', async (t) => {
  const inputs = await fixture(t);
  for (const configuration of [null, [], {}, { projectRoot: '' }, { projectRoot: 5 }, { projectRoot: '\0' }, { projectRoot: 'missing project' }, { projectRoot: 'app.asar/model' }]) {
    await fsp.writeFile(inputs.configFile, JSON.stringify(configuration));
    assert.throws(() => resolveApplicationPaths({ ...inputs, isPackaged: true }), (error) => error.message.includes(inputs.configFile) && error.message.includes('projectRoot'));
  }
  await fsp.writeFile(inputs.configFile, '{ malformed');
  assert.throws(() => resolveApplicationPaths({ ...inputs, isPackaged: true }), /无法读取运行环境配置/);
  await fsp.unlink(inputs.configFile);
  assert.throws(() => resolveApplicationPaths({ ...inputs, isPackaged: true }), /无法读取运行环境配置/);
});

test('missing bundled backend is rejected before launching the interface', async (t) => {
  const inputs = await fixture(t);
  await fsp.unlink(path.join(inputs.backendRoot, 'run_worker.py'));
  assert.throws(() => resolveApplicationPaths({ ...inputs, isPackaged: true }), /Python 后端不完整/);
});

test('packaged worker launches bundled entry and passes the external project as its data root', async () => {
  const child = new EventEmitter();
  child.pid = 123; child.exitCode = null;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const projectRoot = path.resolve('external data');
  const backendRoot = path.resolve('resources/python');
  const runtime = { python: path.join(projectRoot, '.venv-tts', 'Scripts', 'python.exe'), modelPath: path.join(projectRoot, 'model', 'tts'), gpuIndex: '0' };
  let invocation;
  const worker = runPythonWorker({ projectRoot, backendRoot, runtime, payload: { operation: 'health', kind: 'tts' }, platform: 'win32', spawnProcess(program, arguments_, options) { invocation = { program, arguments_, options }; return child; } });
  assert.equal(invocation.program, runtime.python);
  assert.deepEqual(invocation.arguments_, ['-u', path.join(backendRoot, 'run_worker.py')]);
  assert.equal(invocation.options.cwd, projectRoot);
  assert.equal(invocation.options.env.QWEN_STUDIO_PROJECT_ROOT, projectRoot);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.env.HF_HUB_OFFLINE, '1');
  child.stdout.write('{"type":"result","result":{"ready":true}}\n');
  child.emit('close', 0);
  assert.deepEqual(await worker.promise, { ready: true });
});

test('packaged Python uses bundled code and external data even when cwd contains another src package', async (t) => {
  const inputs = await fixture(t);
  const sourceRoot = path.resolve(__dirname, '..');
  const python = path.join(sourceRoot, '.venv-tts', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  assert.ok(fs.existsSync(python), 'Packaging verification requires the project TTS Python environment.');
  await fsp.copyFile(path.join(sourceRoot, 'scripts', 'python-entry.py'), path.join(inputs.backendRoot, 'run_worker.py'));
  for (const name of ['__init__.py', 'common.py', 'worker.py']) await fsp.copyFile(path.join(sourceRoot, 'src', 'backend', name), path.join(inputs.backendRoot, 'src', 'backend', name));
  await fsp.writeFile(path.join(inputs.backendRoot, 'src', '__init__.py'), '"""Bundled Python package."""\n');
  const foreignCwd = path.join(inputs.directory, 'foreign working directory');
  await fsp.mkdir(path.join(foreignCwd, 'src'), { recursive: true });
  await fsp.writeFile(path.join(foreignCwd, 'src', '__init__.py'), 'raise AssertionError("External source package imported")\n');
  const voices = path.join(inputs.projectRoot, 'voice_design');
  await fsp.mkdir(voices);
  await Promise.all([['voice.wav', 'small audio fixture'], ['voice_prompt.txt', '清晰温和女声'], ['voice_text.txt', '读取外部声音库']].map(([name, contents]) => fsp.writeFile(path.join(voices, name), contents)));
  await fsp.writeFile(path.join(voices, 'voice_library.csv'), 'id,name,audio_file,prompt_file,text_file,duration_seconds\nexternal_voice,外部声音,voice.wav,voice_prompt.txt,voice_text.txt,1\n');
  const result = spawnSync(python, ['-u', path.join(inputs.backendRoot, 'run_worker.py')], {
    cwd: foreignCwd, input: '{"operation":"voices"}\n', encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, QWEN_STUDIO_PROJECT_ROOT: inputs.projectRoot, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.type, 'result');
  assert.equal(response.result.voices[0].id, 'external_voice');
  assert.equal(response.result.voices[0].audioPath, path.join(voices, 'voice.wav'));
  assert.equal(response.result.voices[0].instruct, '清晰温和女声');
});
