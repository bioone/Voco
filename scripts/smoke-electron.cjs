/** Exercise the built Electron renderer and IPC without loading model weights. */
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const reviewDir = path.join(root, '.impeccable', 'review');
const checkDir = path.join(root, 'outputs', 'desktop-check');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.setPath('userData', path.join(checkDir, 'state'));
process.env.STUDIO_SMOKE_TEST = '1';
const { defaultSettings } = require('../src/electron/guards.cjs');
fsSync.mkdirSync(path.join(checkDir, 'state'), { recursive: true });
const seededJobs = ['tts', 'asr'].flatMap(type => {
 const file = path.join(root, 'outputs', type, `desktop_smoke_${type}_20261005`, 'metadata.json');
 if (!fsSync.existsSync(file)) return [];
 const result = JSON.parse(fsSync.readFileSync(file, 'utf8'));
 return [{ id: result.id, type, status: 'completed', createdAt: result.createdAt,
  finishedAt: result.createdAt, request: type === 'tts' ? { type, text: result.text, language: result.language, instruct: result.instruct, name: result.name } : { type, audioPath: result.inputAudioPath },
  result, progress: { message: '真实 GPU 验证已完成' }, logs: ['真实 GPU 验证已完成'] }];
});
fsSync.writeFileSync(path.join(checkDir, 'state', 'studio-state.json'), JSON.stringify({ settings: defaultSettings(root), jobs: seededJobs }));
require('../src/electron/main.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = async (win, source) => win.webContents.executeJavaScript(source, true);
async function main() {
 await app.whenReady();
 let win;
 for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win && !win.webContents.isLoading()) break; await wait(100); }
 if (!win) throw new Error('Electron did not create a window');
 await fs.mkdir(reviewDir, { recursive: true }); await fs.mkdir(checkDir, { recursive: true });
 win.webContents.backgroundThrottling = false;
 const errors = [];
 const contrastResults = [];
 const contrastAudit = () => {
  const linear = x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
  const luminance = rgb => .2126*linear(rgb[0])+.7152*linear(rgb[1])+.0722*linear(rgb[2]);
  const color = css => css.match(/[\d.]+/g)?.map(Number);
  const background = element => {
   for (let current = element; current; current = current.parentElement) {
    const rgb = color(getComputedStyle(current).backgroundColor);
    if (rgb && (rgb.length === 3 || rgb[3] > .99)) return rgb;
   }
   return [255,255,255];
  };
  const failures = [];
  const check = (element, text, foreground) => {
   if (!element.getClientRects().length || element.closest('button:disabled,[hidden],svg') || getComputedStyle(element).visibility === 'hidden') return;
   const style = getComputedStyle(element);
   const fg = color(foreground || style.color), bg = background(element);
   if (!fg) return;
   const ratio = (Math.max(luminance(fg),luminance(bg))+.05)/(Math.min(luminance(fg),luminance(bg))+.05);
   const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
   if (ratio < (large ? 3 : 4.5)) failures.push({text:text.slice(0,40),ratio:Number(ratio.toFixed(2)),selector:element.className});
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node=walker.nextNode())) if (node.textContent.trim()) check(node.parentElement,node.textContent.trim());
  for (const element of document.querySelectorAll('input,textarea')) { check(element,element.value || element.placeholder); if (element.placeholder) check(element,element.placeholder,getComputedStyle(element,'::placeholder').color); }
  return failures;
 };
 win.webContents.on('console-message', details => { if (details.level === 'error' || details.level === 3) errors.push(details.message); });
 const bootstrap = await run(win, 'window.studio.getBootstrap()');
 if (bootstrap.voices.length < 76) throw new Error('Existing voices missing');
 if (await run(win, 'typeof window.require') !== 'undefined') throw new Error('Renderer exposes Node');
 await run(win, `window.studio.submitJob({type:'tts',text:'',language:'Chinese',instruct:'bad'}).then(()=>{throw new Error('Invalid job accepted')},()=>true)`);
 await run(win, `window.studio.getAudioUrl(${JSON.stringify(path.join(root, 'package.json'))}).then(()=>{throw new Error('Non audio accepted')},()=>true)`);
 // Native save dialog mocked to a named verification artifact; copy path uses real IPC.
 dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(checkDir, 'exported-voice.wav') });
 const exported = await run(win, `window.studio.exportFile({path:${JSON.stringify(bootstrap.voices[0].audioPath)}})`);
 if (!(await fs.stat(exported)).size) throw new Error('Audio export is empty');
 const go = async label => {
  await run(win, `Array.from(document.querySelectorAll('.nav-item')).find(x=>x.textContent.includes(${JSON.stringify(label)})).click()`);
  await wait(350);
 };
 const capture = async filename => { await wait(350); const contrastFailures = await run(win, '(' + contrastAudit.toString() + ')()'); contrastResults.push({filename, failures:contrastFailures}); const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await fs.writeFile(path.join(reviewDir, filename), image.toPNG()); };
 win.setMinimumSize(390, 600); win.setContentSize(1440, 900); win.showInactive(); await wait(350);
 await go('语音合成'); await run(win, `Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('填入示例')).click()`); await capture('desktop.png');
 if (!(await run(win, `document.querySelector('#tts-text').value`)).includes('欢迎')) throw new Error('Example button not wired');
 await go('语音转文字'); await capture('asr.png');
 await run(win, `Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('开始录音')).click()`);
 for (let i = 0; i < 40; i++) { if (await run(win, `Boolean(document.querySelector('.record-feedback'))`)) break; await wait(100); }
 if (!(await run(win, `Boolean(document.querySelector('.record-feedback'))`))) throw new Error('Recording did not start');
 await wait(650);
 await run(win, `Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('结束录音')).click()`);
 for (let i = 0; i < 40; i++) { if (await run(win, `Boolean(document.querySelector('.file-path'))`)) break; await wait(100); }
 const recordingPath = await run(win, `document.querySelector('.file-path')?.textContent`);
 if (!recordingPath?.includes('recordings') || (await fs.stat(recordingPath)).size < 46) throw new Error('Recording did not save a WAV');
 // Exercise external source picker consent separately from app output playback.
 const selectedInput = path.join(reviewDir, 'selected-input.wav');
 await fs.copyFile(bootstrap.voices[0].audioPath, selectedInput);
 dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedInput] });
 await run(win, `Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('更换文件')).click()`); await wait(180);
 const selectedUrl = await run(win, `window.studio.getAudioUrl(${JSON.stringify(selectedInput)})`);
 if (!selectedUrl.startsWith('studio-audio:')) throw new Error('Selected source cannot preview');
 await go('声音库'); await run(win, `document.querySelector('.voice-row').click()`); await wait(200);
 const playback = await run(win, `(async()=>{const audio=document.querySelector('audio');if(!audio)throw new Error('No audio');await Promise.race([new Promise((resolve,reject)=>{if(audio.readyState>=1)return resolve();audio.onloadedmetadata=resolve;audio.onerror=()=>reject(new Error('Audio protocol failed'));}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Audio metadata timeout')),12000))]);return {duration:audio.duration,src:audio.src};})()`);
 if (!Number.isFinite(playback.duration) || playback.duration <= 0 || !playback.src.startsWith('studio-audio:')) throw new Error('Invalid playback');
 await run(win, `(async()=>{const audio=document.querySelector('audio');audio.muted=true;await audio.play();await new Promise(r=>setTimeout(r,600));if(audio.currentTime<=0)throw new Error('Audio does not advance');audio.pause();return true;})()`);
 await capture('voices.png');
 await run(win, `Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('用这个描述合成')).click()`); await wait(100);
 if (!(await run(win, `document.querySelector('#tts-text').value`)).includes('欢迎')) throw new Error('Draft lost while browsing library');
 if (!(await run(win, `document.querySelector('#tts-instruct').value`)).length) throw new Error('Voice prompt reuse failed');
 await go('任务记录'); await capture('history.png');
 await go('环境设置'); await capture('settings.png');
 const health = await run(win, 'window.studio.checkHealth()');
 if (!health.tts.capabilities.tts || !health.asr.capabilities.asr) throw new Error('Configured local runtimes are not ready');
 win.setContentSize(1050, 760); await go('语音合成'); await capture('compact.png');
 if (await run(win, 'document.documentElement.scrollWidth > innerWidth') ) throw new Error('Compact desktop overflows');
 win.setContentSize(390, 844); await capture('mobile.png');
 if (await run(win, 'document.documentElement.scrollWidth > innerWidth') ) throw new Error('Narrow layout overflows');
 const result = { contrastResults, voices: bootstrap.voices.length, playback, recordingPath, selectedUrl, exported, health: { tts: health.tts.capabilities, asr: health.asr.capabilities }, rendererErrors: errors };
 if (contrastResults.some(entry => entry.failures.length)) throw new Error(JSON.stringify(contrastResults.filter(entry => entry.failures.length)));
 if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
 await fs.writeFile(path.join(checkDir, 'report.json'), JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result)); app.quit();
}
main().catch(error => { console.error(error.stack); app.exit(1); });
setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 90000).unref();





