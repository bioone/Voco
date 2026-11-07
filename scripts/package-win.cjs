/** Windows folder distribution using Electron's installed, complete runtime. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function copyPythonModules(projectRoot, pythonRoot) {
 await fs.mkdir(path.join(pythonRoot, 'src'), { recursive: true });
 await fs.writeFile(path.join(pythonRoot, 'src', '__init__.py'), '"""Packaged speech backend."""\n', 'utf8');
 for (const kind of ['backend', 'tts', 'asr']) {
  await fs.cp(path.join(projectRoot, 'src', kind), path.join(pythonRoot, 'src', kind), {
   recursive: true, errorOnExist: true, force: false,
   filter: file => !file.split(path.sep).includes('__pycache__') && !/\.py[co]$/i.test(file),
  });
 }
 await fs.copyFile(path.join(projectRoot, 'scripts', 'python-entry.py'), path.join(pythonRoot, 'run_worker.py'));
}

async function buildUnpacked(projectRoot, runtimeRoot) {
 if (process.platform !== 'win32') throw new Error('此打包命令需要 Windows x64 环境。');
 projectRoot = path.resolve(projectRoot);
 runtimeRoot = path.resolve(runtimeRoot);
 const packageInfo = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
 for (const file of ['electron.exe', 'resources.pak', 'icudtl.dat']) {
  if (!(await fs.stat(path.join(runtimeRoot, file))).isFile()) throw new Error(`Electron 运行时缺少 ${file}。请重新安装项目 Electron。`);
 }
 if (!(await fs.stat(path.join(projectRoot, 'dist', 'index.html'))).isFile()) throw new Error('请先运行 npm run build。');
 const releaseRoot = path.join(projectRoot, 'release');
 await fs.mkdir(releaseRoot, { recursive: true });
 let outputRoot = path.join(releaseRoot, 'win-unpacked');
 try { await fs.access(outputRoot); outputRoot = path.join(releaseRoot, `win-unpacked-${new Date().toISOString().replace(/[:.]/g, '-')}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 const stage = path.join(releaseRoot, `.unpacked-build-${randomUUID()}`);
 await fs.mkdir(stage);
 try {
  console.log('复制已安装的 Electron 运行时，不下载模型或 Python 依赖…');
  await Promise.all((await fs.readdir(runtimeRoot)).map(entry => fs.cp(path.join(runtimeRoot, entry), path.join(stage, entry), { recursive: true, errorOnExist: true, force: false })));
  await fs.rename(path.join(stage, 'electron.exe'), path.join(stage, 'qwenASR.exe'));
  const appRoot = path.join(stage, 'resources', 'app');
  await fs.mkdir(path.join(appRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
   name: packageInfo.name, version: packageInfo.version,
   description: packageInfo.description, main: 'src/electron/main.cjs', type: 'module', private: true,
  }, null, 2), 'utf8');
  await fs.cp(path.join(projectRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true, force: false, errorOnExist: true });
  await fs.cp(path.join(projectRoot, 'src', 'electron'), path.join(appRoot, 'src', 'electron'), { recursive: true, force: false, errorOnExist: true });
  await copyPythonModules(projectRoot, path.join(stage, 'resources', 'python'));
  await fs.writeFile(path.join(stage, 'resources', 'runtime-location.json'), JSON.stringify({ projectRoot: '../../..' }, null, 2), 'utf8');
  await fs.writeFile(path.join(stage, '使用说明.txt'), [
   'qwenASR 语音工作台', '', '双击 qwenASR.exe 启动，无需 Node.js 或 npm。',
   '请保留整个 unpacked 文件夹，EXE 需要同目录的 DLL、locales 和 resources。',
   '当前版本使用原项目中的 model、.venv-tts、.venv-asr、voice_design 和 outputs。',
   '默认 resources/runtime-location.json 的 projectRoot 为相对 resources 目录的 ../../..。',
   '保持软件位于项目 release 下即可直接运行；移动软件后可修改此配置指向原项目目录。',
   '模型及 Python 环境未打入此文件夹。环境设置可分别选择 Python 和模型。',
   '生成音频和转写结果保存在原项目 outputs 目录；现有声音库只读。',
   '启动界面不会加载模型；点击生成或转写后才会使用 GPU。',
  ].join('\r\n'), 'utf8');
  const electronVersion = (await fs.readFile(path.join(runtimeRoot, 'version'), 'utf8')).trim();
  await fs.writeFile(path.join(stage, 'build-info.json'), JSON.stringify({
   product: packageInfo.name, version: packageInfo.version, electronVersion, platform: 'win32', arch: 'x64',
   createdAt: new Date().toISOString(), runtimeLocation: 'resources/runtime-location.json',
   dependencies: 'External project model weights and Python environments',
  }, null, 2), 'utf8');
  // No previous distribution is replaced or removed.
  await fs.rename(stage, outputRoot);
  return outputRoot;
 } catch (error) {
  throw new Error(`打包失败：${error.message}。未删除已有产物；未完成目录保留在 ${stage}`);
 }
}

async function main() {
 const root = path.resolve(__dirname, '..');
 const electronRoot = path.dirname(require.resolve('electron/package.json'));
 const output = await buildUnpacked(root, path.join(electronRoot, 'dist'));
 console.log(`已生成 ${path.join(output, 'qwenASR.exe')}`);
 console.log(`保留整个目录：${output}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildUnpacked, copyPythonModules };

