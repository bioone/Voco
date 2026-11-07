const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { StateStore } = require('./state.cjs');
const { JobQueue } = require('./queue.cjs');
const { runPythonWorker } = require('./worker.cjs');
const { readVoiceLibrary } = require('./library.cjs');
const { audioResponse } = require('./audio.cjs');
const { resolveApplicationPaths } = require('./paths.cjs');
const { AUDIO_EXTENSIONS, resolveRuntime, allowedFile, isWithin, validateRecording, canonicalAudioFile, playableAudioFile } = require('./guards.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'studio-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..', '..');
const rendererFile = path.join(appRoot, 'dist', 'index.html');
const packagedCheck = app.isPackaged && process.env.STUDIO_PACKAGED_CHECK === '1';
if (packagedCheck && process.env.STUDIO_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.STUDIO_USER_DATA_DIR));
let projectRoot;
let backendRoot;
let applicationPaths;
let rendererUrl = null;
if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
  const url = new URL(process.env.ELECTRON_RENDERER_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('开发界面必须使用本地 HTTP 地址。');
  rendererUrl = url.href;
}
let mainWindow;
let store;
let queue;
let quitting = false;
let healthCheck = null;
const healthWorkers = new Set();
const audioTokens = new Map();
const audioPaths = new Map();
const selectedAudio = new Set();

function trustedUrl(value) {
  try {
    const url = new URL(value);
    if (rendererUrl) return url.origin === new URL(rendererUrl).origin && url.pathname === new URL(rendererUrl).pathname;
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === rendererFile;
  } catch { return false; }
}

function handle(name, callback) {
  ipcMain.handle(`studio:${name}`, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame || !trustedUrl(event.senderFrame.url)) throw new Error('请求来源无效。');
    return callback(...args);
  });
}

function installIpc() {
  handle('getBootstrap', async () => ({ settings: store.settings(), voices: await readVoiceLibrary(projectRoot), jobs: queue.list(), warning: store.warning }));
  handle('getSettings', () => store.settings());
  handle('saveSettings', (settings) => store.settings(settings));
  handle('getJobs', () => queue.list());
  handle('submitJob', (request) => queue.submit(request));
  handle('cancelJob', (id) => { if (typeof id !== 'string') throw new Error('任务编号无效。'); return queue.cancel(id); });
  handle('checkHealth', async () => {
    if (healthCheck) return healthCheck;
    const settings = store.settings();
    healthCheck = (async () => {
      const entries = await Promise.all(['tts', 'asr'].map(async (kind) => {
        const worker = runPythonWorker({ projectRoot, backendRoot, runtime: resolveRuntime(projectRoot, settings, kind), payload: { operation: 'health', kind }, timeoutMs: 60000 });
        healthWorkers.add(worker);
        try { return [kind, await worker.promise]; }
        catch (error) { return [kind, { ok: false, error: error.message, issues: [error.message] }]; }
        finally { healthWorkers.delete(worker); }
      }));
      return Object.fromEntries(entries);
    })();
    try { return await healthCheck; } finally { healthCheck = null; }
  });
  handle('chooseFile', async (kind) => {
    if (kind !== 'audio') throw new Error('文件类型无效。');
    const selected = await dialog.showOpenDialog(mainWindow, { title: '选择需要转写的音频', properties: ['openFile'], filters: [{ name: '音频文件', extensions: [...AUDIO_EXTENSIONS].map((item) => item.slice(1)) }] });
    if (selected.canceled) return null;
    const canonical = await canonicalAudioFile(selected.filePaths[0]);
    selectedAudio.add(canonical);
    return canonical;
  });
  handle('choosePython', async (kind) => {
    if (!['tts', 'asr'].includes(kind)) throw new Error('环境类型无效。');
    const selected = await dialog.showOpenDialog(mainWindow, { title: `选择 ${kind.toUpperCase()} Python 解释器`, properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Python 解释器', extensions: ['exe'] }] } : {}) });
    return selected.canceled ? null : selected.filePaths[0];
  });
  handle('chooseModel', async (kind) => {
    if (!['tts', 'asr'].includes(kind)) throw new Error('模型类型无效。');
    const selected = await dialog.showOpenDialog(mainWindow, { title: `选择 ${kind.toUpperCase()} 本地模型目录`, defaultPath: path.join(projectRoot, 'model'), properties: ['openDirectory'] });
    return selected.canceled ? null : selected.filePaths[0];
  });
  handle('getAudioUrl', async (file) => {
    const canonical = await playableAudioFile(projectRoot, file, selectedAudio);
    let token = audioPaths.get(canonical);
    if (!token) { token = randomUUID(); audioPaths.set(canonical, token); audioTokens.set(token, canonical); }
    return `studio-audio://audio/${token}`;
  });
  handle('saveRecording', async (request) => {
    const bytes = validateRecording(request?.bytes);
    const outputs = path.join(projectRoot, 'outputs');
    await fs.mkdir(outputs, { recursive: true });
    const canonicalOutputs = await fs.realpath(outputs);
    const canonicalRoot = await fs.realpath(projectRoot);
    const modelRoot = await fs.realpath(path.join(projectRoot, 'model'));
    if (!isWithin(canonicalRoot, canonicalOutputs) || isWithin(modelRoot, canonicalOutputs)) throw new Error('录音输出目录必须位于项目内，且不能是模型目录。');
    const directory = path.join(canonicalOutputs, 'recordings');
    await fs.mkdir(directory, { recursive: true });
    const canonicalDirectory = await fs.realpath(directory);
    if (!isWithin(canonicalOutputs, canonicalDirectory)) throw new Error('录音目录指向了应用输出目录之外。');
    const destination = path.join(canonicalDirectory, `${randomUUID()}.wav`);
    await fs.writeFile(destination, bytes, { flag: 'wx' });
    return destination;
  });
  handle('revealFile', async (file) => { shell.showItemInFolder(await allowedFile(projectRoot, file)); return true; });
  handle('copyText', (text) => {
    if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('复制内容无效或过长。');
    clipboard.writeText(text);
    return true;
  });
  handle('exportFile', async (request) => {
    if (!request || typeof request.path !== 'string') throw new Error('导出参数无效。');
    const source = await allowedFile(projectRoot, request.path);
    const extension = path.extname(source).slice(1);
    const selected = await dialog.showSaveDialog(mainWindow, { title: '导出文件', defaultPath: path.basename(source), filters: [{ name: extension.toUpperCase() || '文件', extensions: [extension || '*'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (selected.canceled || !selected.filePath) return null;
    const parent = await fs.realpath(path.dirname(selected.filePath));
    let modelRoot;
    try { modelRoot = await fs.realpath(path.join(projectRoot, 'model')); } catch { modelRoot = path.join(projectRoot, 'model'); }
    if (isWithin(modelRoot, parent)) throw new Error('不能将导出文件写入模型目录。');
    const destination = path.join(parent, path.basename(selected.filePath));
    let destinationReal;
    try { destinationReal = await fs.realpath(destination); } catch { /* New export file. */ }
    if (destinationReal && isWithin(modelRoot, destinationReal)) throw new Error('不能覆盖模型文件。');
    if (destinationReal !== source) await fs.copyFile(source, destination);
    return destination;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1050, minHeight: 720, title: 'qwenASR · 语音工作台', backgroundColor: '#f5f7f4', show: process.env.STUDIO_SMOKE_TEST !== '1' && !packagedCheck,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!trustedUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const trustedMedia = (contents, permission, details) => contents === mainWindow?.webContents && permission === 'media' && details.isMainFrame === true && trustedUrl(details.requestingUrl || contents.getURL());
  mainWindow.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => trustedMedia(contents, permission, details) && details.mediaType === 'audio');
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(trustedMedia(contents, permission, details) && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every((kind) => kind === 'audio')));
  mainWindow.on('closed', () => { mainWindow = null; });
  return rendererUrl ? mainWindow.loadURL(rendererUrl) : mainWindow.loadFile(rendererFile);
}

async function writePackagedReport(result) {
  const destination = process.env.STUDIO_PACKAGED_REPORT;
  if (!destination || !path.isAbsolute(destination)) throw new Error('打包验证需要设置绝对路径 STUDIO_PACKAGED_REPORT。');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(result, null, 2), 'utf8');
}

async function verifyPackagedApplication() {
  const renderer = await mainWindow.webContents.executeJavaScript(`({ studioAvailable: typeof window.studio?.getBootstrap === 'function', nodeAvailable: typeof window.require !== 'undefined', title: document.title, bodyLength: document.body.textContent.length })`);
  if (!renderer.studioAvailable || renderer.nodeAvailable || renderer.bodyLength === 0) throw new Error('打包界面或安全 preload 未正确加载。');
  const bootstrap = await mainWindow.webContents.executeJavaScript('window.studio.getBootstrap()');
  const health = await mainWindow.webContents.executeJavaScript('window.studio.checkHealth()');
  const ok = Boolean(health.tts.ready && health.asr.ready);
  const result = { ok, status: ok ? 'passed' : 'failed', isPackaged: app.isPackaged, execPath: process.execPath, paths: applicationPaths, rendererStudio: renderer.studioAvailable, renderer, voiceCount: bootstrap.voices.length, health };
  await writePackagedReport(result);
  app.exit(result.ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    applicationPaths = resolveApplicationPaths({ appPath: appRoot, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    ({ projectRoot, backendRoot } = applicationPaths);
    store = new StateStore(app.getPath('userData'), projectRoot);
    queue = new JobQueue({ savedJobs: store.data.jobs, run: (job, onEvent) => runPythonWorker({
      projectRoot, backendRoot, runtime: resolveRuntime(projectRoot, store.settings(), job.type),
      payload: { operation: job.type, job_id: job.id, text: job.request.text, language: job.request.language, instruct: job.request.instruct, name: job.request.name, audio_path: job.request.audioPath }, onEvent,
    }), onChange: (job, jobs) => {
      try { store.jobs(jobs.slice().reverse()); } catch (error) { console.error('保存任务历史失败：', error.message); }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:job', job);
    } });
    store.jobs(queue.list().reverse());
    protocol.handle('studio-audio', async (request) => {
      try {
        const url = new URL(request.url);
        const token = url.pathname.slice(1);
        if (url.hostname !== 'audio' || !audioTokens.has(token) || !['GET', 'HEAD'].includes(request.method)) return new Response('Audio not found', { status: 404 });
        const file = await playableAudioFile(projectRoot, audioTokens.get(token), selectedAudio);
        return await audioResponse(file, { method: request.method, range: request.headers.get('Range') });
      } catch { return new Response('Audio unavailable', { status: 404 }); }
    });
    installIpc();
    await createWindow();
    if (packagedCheck) await verifyPackagedApplication();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(async (error) => {
    if (packagedCheck) {
      try { await writePackagedReport({ ok: false, status: 'failed', isPackaged: app.isPackaged, execPath: process.execPath, paths: applicationPaths, error: error.message }); }
      catch (reportError) { console.error(reportError.message); }
      app.exit(1);
    } else { dialog.showErrorBox('应用启动失败', error.message); app.quit(); }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting || !queue) return;
    quitting = true;
    event.preventDefault();
    for (const worker of healthWorkers) worker.cancel();
    const deadline = setTimeout(() => app.exit(0), 6000);
    queue.shutdown().finally(() => { clearTimeout(deadline); app.quit(); });
  });
}

