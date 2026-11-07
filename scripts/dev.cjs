const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const electron = require('electron');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteCli, '--config', 'vite.config.js'], { cwd: root, stdio: 'inherit', windowsHide: true });
let desktop;
let closing = false;
function stop(code = 0) {
 if (closing) return; closing = true;
 for (const child of [desktop, vite]) if (child && child.exitCode === null) child.kill();
 process.exitCode = code;
}
async function start() {
 const url = 'http://127.0.0.1:5173/';
 for (let i = 0; i < 100; i++) {
  if (closing) return;
  try { const response = await fetch(url); if (response.ok) break; } catch {}
  if (i === 99) throw new Error('Vite 启动超时，请检查 5173 端口。');
  await new Promise(resolve => setTimeout(resolve, 200));
 }
 desktop = spawn(electron, ['.'], { cwd: root, env: { ...process.env, ELECTRON_RENDERER_URL: url }, stdio: 'inherit', windowsHide: false });
 desktop.on('exit', code => stop(code || 0)); desktop.on('error', error => { console.error(error.message); stop(1); });
}
vite.on('error', error => { console.error(error.message); stop(1); });
vite.on('exit', code => { if (!closing) stop(code || 1); });
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
start().catch(error => { console.error(error.message); stop(1); });
