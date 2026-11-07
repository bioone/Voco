const fs = require('node:fs');
const path = require('node:path');

function isAsarPath(value) {
  return value.split(/[\\/]+/).some((part) => part.toLowerCase().endsWith('.asar'));
}

function resolveApplicationPaths({ appPath, resourcesPath, isPackaged }) {
  const appRoot = path.resolve(appPath);
  const rendererFile = path.join(appRoot, 'dist', 'index.html');
  if (!isPackaged) return { appRoot, rendererFile, projectRoot: appRoot, backendRoot: undefined, configFile: undefined };

  const configFile = path.join(resourcesPath, 'runtime-location.json');
  const fail = (reason) => {
    throw new Error(`${reason}\n请检查 ${configFile}，将 projectRoot 设置为包含 model、.venv-tts、.venv-asr 和声音库的项目目录。相对路径以 resources 目录为基准。`);
  };
  let configuration;
  try { configuration = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch (error) { fail(`无法读取运行环境配置：${error.message}`); }
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)
      || typeof configuration.projectRoot !== 'string' || !configuration.projectRoot.trim()
      || configuration.projectRoot.includes('\0')) fail('运行环境配置中的 projectRoot 必须是非空目录路径。');

  const projectRoot = path.resolve(resourcesPath, configuration.projectRoot);
  if (isAsarPath(projectRoot)) fail('模型、Python 环境和声音库必须放在应用归档之外的普通目录中。');
  let projectValid = false;
  try { projectValid = fs.statSync(projectRoot).isDirectory() && fs.statSync(path.join(projectRoot, 'model')).isDirectory(); }
  catch { /* Missing or inaccessible external runtime; show the same repair instructions. */ }
  if (!projectValid) fail(`找不到运行环境目录或 model 目录：${projectRoot}`);

  const backendRoot = path.join(resourcesPath, 'python');
  if (isAsarPath(backendRoot)) fail('Python 后端必须位于应用归档之外。');
  if (!fs.existsSync(path.join(backendRoot, 'run_worker.py')) || !fs.existsSync(path.join(backendRoot, 'src', 'backend', 'worker.py'))) fail(`打包的 Python 后端不完整：${backendRoot}。请重新生成 unpacked 软件。`);
  return { appRoot, rendererFile, projectRoot, backendRoot, configFile };
}

module.exports = { resolveApplicationPaths };
