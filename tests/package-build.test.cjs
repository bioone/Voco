const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildUnpacked } = require('../scripts/package-win.cjs');

const windowsOnly = { skip: process.platform !== 'win32' };

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-packaging-test-'));
  t.after(async () => {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('qwen-packaging-test-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const projectRoot = path.join(temporary, 'project');
  const runtimeRoot = path.join(temporary, 'electron-runtime');
  const write = async (root, relative, contents) => {
    const destination = path.join(root, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents, 'utf8');
  };
  const sourceFiles = {
    'package.json': JSON.stringify({ name: 'qwen-test', version: '1.2.3', description: 'Fixture' }),
    'dist/index.html': '<html><script src="./assets/app.js"></script></html>',
    'dist/assets/app.js': 'console.log("renderer");',
    'src/electron/main.cjs': 'module.exports = {};',
    'src/backend/worker.py': 'def main():\n    return 0\n',
    'src/backend/__pycache__/worker.cpython-310.pyc': 'compiled-cache',
    'src/tts/service.py': 'def synthesize():\n    pass\n',
    'src/asr/service.py': 'def transcribe():\n    pass\n',
    'scripts/python-entry.py': 'from src.backend.worker import main\nraise SystemExit(main())\n',
    'model/weights.safetensors': 'DO NOT SHIP MODEL',
    '.venv-tts/Scripts/python.exe': 'DO NOT SHIP ENVIRONMENT',
    '.venv-asr/Scripts/python.exe': 'DO NOT SHIP ENVIRONMENT',
    'voice_design/personal.wav': 'DO NOT SHIP USER AUDIO',
    'outputs/tts/private.txt': 'DO NOT SHIP USER OUTPUT',
    'node_modules/private-package/index.js': 'DO NOT SHIP NODE MODULES',
    'src/renderer/private.jsx': 'DO NOT SHIP RENDERER SOURCE',
  };
  const runtimeFiles = {
    'electron.exe': 'fixture-executable',
    'resources.pak': 'chromium-resources',
    'icudtl.dat': 'internationalization-data',
    'ffmpeg.dll': 'audio-runtime',
    'locales/zh-CN.pak': 'chinese-locale',
    'resources/default_app.asar': 'electron-default-app',
    'LICENSE': 'electron-license',
    'LICENSES.chromium.html': 'chromium-licenses',
    'version': '44.5.1',
  };
  await Promise.all([
    ...Object.entries(sourceFiles).map(([file, contents]) => write(projectRoot, file, contents)),
    ...Object.entries(runtimeFiles).map(([file, contents]) => write(runtimeRoot, file, contents)),
  ]);
  return { projectRoot, runtimeRoot, runtimeFiles };
}

test('Windows folder includes its complete runtime and app while keeping model, environments and user data external', windowsOnly, async (t) => {
  const { projectRoot, runtimeRoot, runtimeFiles } = await fixture(t);
  const output = await buildUnpacked(projectRoot, runtimeRoot);
  assert.equal(output, path.join(projectRoot, 'release', 'win-unpacked'));
  assert.equal(await fs.readFile(path.join(output, 'qwenASR.exe'), 'utf8'), runtimeFiles['electron.exe']);
  await assert.rejects(fs.access(path.join(output, 'electron.exe')), { code: 'ENOENT' });
  for (const [file, contents] of Object.entries(runtimeFiles)) {
    if (file !== 'electron.exe') assert.equal(await fs.readFile(path.join(output, file), 'utf8'), contents);
  }

  const appRoot = path.join(output, 'resources', 'app');
  const manifest = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.type, 'module');
  assert.equal(path.extname(manifest.main), '.cjs');
  assert.ok((await fs.stat(path.resolve(appRoot, manifest.main))).isFile());
  assert.ok((await fs.stat(path.join(appRoot, 'dist', 'assets', 'app.js'))).isFile());

  const resourcesRoot = path.join(output, 'resources');
  const configuration = JSON.parse(await fs.readFile(path.join(resourcesRoot, 'runtime-location.json'), 'utf8'));
  assert.equal(path.isAbsolute(configuration.projectRoot), false);
  assert.equal(path.resolve(resourcesRoot, configuration.projectRoot), projectRoot);
  assert.ok((await fs.stat(path.join(resourcesRoot, 'python', 'src', '__init__.py'))).isFile());
  assert.ok((await fs.stat(path.join(resourcesRoot, 'python', 'run_worker.py'))).isFile());
  for (const directory of ['backend', 'tts', 'asr']) {
    assert.ok((await fs.stat(path.join(resourcesRoot, 'python', 'src', directory))).isDirectory());
  }
  await assert.rejects(fs.access(path.join(resourcesRoot, 'python', 'src', 'backend', '__pycache__')), { code: 'ENOENT' });
  for (const relative of ['model', '.venv-tts', '.venv-asr', 'voice_design', 'outputs', 'node_modules', 'src/renderer']) {
    await assert.rejects(fs.access(path.join(output, relative)), { code: 'ENOENT' });
    await assert.rejects(fs.access(path.join(appRoot, relative)), { code: 'ENOENT' });
  }
  const metadata = JSON.parse(await fs.readFile(path.join(output, 'build-info.json'), 'utf8'));
  assert.equal(metadata.electronVersion, '44.5.1');
  assert.equal(metadata.arch, 'x64');
  assert.match(await fs.readFile(path.join(output, '使用说明.txt'), 'utf8'), /保留整个 unpacked 文件夹/);
});

test('a repeat build creates a separate folder and preserves the existing distribution', windowsOnly, async (t) => {
  const { projectRoot, runtimeRoot } = await fixture(t);
  const first = await buildUnpacked(projectRoot, runtimeRoot);
  const marker = path.join(first, 'existing-user-note.txt');
  await fs.writeFile(marker, 'Preserve this distribution', 'utf8');
  const second = await buildUnpacked(projectRoot, runtimeRoot);
  assert.notEqual(first, second);
  assert.equal(path.dirname(second), path.join(projectRoot, 'release'));
  assert.equal(await fs.readFile(marker, 'utf8'), 'Preserve this distribution');
  assert.ok((await fs.stat(path.join(second, 'qwenASR.exe'))).isFile());
  const config = JSON.parse(await fs.readFile(path.join(second, 'resources', 'runtime-location.json'), 'utf8'));
  assert.equal(path.resolve(second, 'resources', config.projectRoot), projectRoot);
});

test('an incomplete runtime is rejected before creating a distribution', windowsOnly, async (t) => {
  const { projectRoot, runtimeRoot } = await fixture(t);
  await fs.unlink(path.join(runtimeRoot, 'icudtl.dat'));
  await assert.rejects(buildUnpacked(projectRoot, runtimeRoot), /icudtl\.dat/);
  await assert.rejects(fs.access(path.join(projectRoot, 'release')), { code: 'ENOENT' });
});
