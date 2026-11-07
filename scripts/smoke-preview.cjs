/** Verify sample preview with real local WAV playback; no model loading or GPU work. */
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkRoot = path.join(root, 'outputs', 'preview-check');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(checkRoot, 'state'));
process.env.STUDIO_SMOKE_TEST = '1';
require('../src/electron/main.cjs');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function run(window, source) {
  try { return await window.webContents.executeJavaScript(source, true); }
  catch (error) { throw new Error(`界面验证脚本失败：${source}\n${error.message}`); }
}
async function until(window, source, label, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await run(window, source)) return;
    await wait(60);
  }
  throw new Error(`等待超时：${label}`);
}

async function main() {
  await app.whenReady();
  let window;
  for (let attempt = 0; attempt < 100; attempt++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading()) break;
    await wait(100);
  }
  assert.ok(window, 'Electron 必须创建窗口');
  window.webContents.backgroundThrottling = false;
  const rendererErrors = [];
  window.webContents.on('console-message', details => {
    if (details.level === 'error' || details.level === 3) rendererErrors.push(details.message);
  });
  await until(window, 'Boolean(document.querySelector("#tts-text"))', '合成界面');
  await fs.mkdir(checkRoot, { recursive: true });
  const bootstrap = await run(window, 'window.studio.getBootstrap()');
  const samples = ['emotion_healing', 'movie_narrator_male', 'knowledge_professional_female'].map(id => {
    const voice = bootstrap.voices.find(item => item.id === id);
    assert.ok(voice?.audioPath && voice.instruct && voice.text, `例音 ${id} 必须完整`);
    return voice;
  });
  const urls = {};
  for (const voice of [...samples, bootstrap.voices.find(item => item.id === 'english_storyteller')]) {
    assert.ok(voice?.audioPath, '英文声音库示例必须存在');
    urls[voice.audioPath] = await run(window, `window.studio.getAudioUrl(${JSON.stringify(voice.audioPath)})`);
  }
  await run(window, `(() => {
    window.previewEvents = { plays: [], pauses: [] };
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function(...args) {
      this.muted = true;
      window.previewEvents.plays.push({ src: this.src, time: this.currentTime });
      return originalPlay.apply(this, args);
    };
    HTMLMediaElement.prototype.pause = function(...args) {
      window.previewEvents.pauses.push({ src: this.src, time: this.currentTime });
      return originalPause.apply(this, args);
    };
    document.addEventListener('play', event => { event.target.muted = true; }, true);
  })()`);
  await wait(220);
  assert.equal(await run(window, 'window.previewEvents.plays.length'), 0, '初次打开不得自动试听');

  const text = 'Preview must preserve my typed text and my chosen language.';
  await run(window, `(() => {
    const field = document.querySelector('#tts-text');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const language = document.querySelector('#tts-language');
    language.value = 'English'; language.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const selectPreset = index => run(window, `document.querySelectorAll('.preset')[${index}].click()`);
  const go = label => run(window, `Array.from(document.querySelectorAll('.nav-item')).find(item => item.textContent.includes(${JSON.stringify(label)})).click()`);
  const state = () => run(window, `(() => {
    const audio = document.querySelector('audio[aria-label^="例音"]');
    return { audio: audio && { src: audio.src, duration: audio.duration, currentTime: audio.currentTime, paused: audio.paused, error: audio.error?.code || null },
      text: document.querySelector('#tts-text')?.value, language: document.querySelector('#tts-language')?.value,
      instruct: document.querySelector('#tts-instruct')?.value, sample: document.querySelector('.voice-sample')?.textContent };
  })()`);
  async function playing(expectedUrl) {
    await until(window, `(() => {
      const audio = document.querySelector('audio[aria-label^="例音"]') || document.querySelector('.voice-detail audio');
      return audio && audio.src === ${JSON.stringify(expectedUrl)} && !audio.paused && audio.currentTime > 0.1 && Number.isFinite(audio.duration) && audio.duration > 0;
    })()`, '例音实际播放');
  }
  const report = { voiceCount: bootstrap.voices.length, checks: [], playback: [] };
  for (let index = 0; index < samples.length; index++) {
    const voice = samples[index];
    await selectPreset(index);
    await playing(urls[voice.audioPath]);
    const snapshot = await state();
    assert.equal(snapshot.text, text, '选择快捷声音必须保留文本');
    assert.equal(snapshot.language, 'English', '选择快捷声音必须保留已选语言');
    assert.equal(snapshot.instruct, voice.instruct, '快捷声音必须采用录制例音的真实提示词');
    assert.ok(snapshot.sample.includes(voice.name) && snapshot.sample.includes(voice.text), '必须展示例音名称和文本');
    report.playback.push({ id: voice.id, ...snapshot.audio });
  }
  report.checks.push('首次静音打开', '三个快捷声音的真实例音、提示词、文本和语言保留');

  let playsBefore = await run(window, 'window.previewEvents.plays.length');
  await selectPreset(2);
  await until(window, `window.previewEvents.plays.length > ${playsBefore}`, '同一快捷声音重新播放');
  assert.ok((await run(window, 'window.previewEvents.plays.at(-1).time')) < 0.15, '重选同一声音必须从头开始');
  await playing(urls[samples[2].audioPath]);
  report.checks.push('同一快捷声音重播');

  const english = bootstrap.voices.find(item => item.id === 'english_storyteller');
  await run(window, `(() => { const select = document.querySelector('#library-voice'); select.value = ${JSON.stringify(english.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await playing(urls[english.audioPath]);
  let snapshot = await state();
  assert.equal(snapshot.instruct, english.instruct, '声音库选择必须使用正确提示词');
  assert.equal(snapshot.text, text, '声音库选择必须保留文本');
  assert.equal(snapshot.language, english.language, '声音库复用保留原有语言同步行为');
  playsBefore = await run(window, 'window.previewEvents.plays.length');
  await run(window, 'document.querySelector(".voice-sample .preview-replay").click()');
  await until(window, `window.previewEvents.plays.length > ${playsBefore}`, '声音库选项重新试听');
  assert.ok((await run(window, 'window.previewEvents.plays.at(-1).time')) < 0.15, '重新试听必须从头开始');
  report.checks.push('声音库下拉选择和重新试听');

  await run(window, `(() => {
    window.previewOldAudio = document.querySelector('audio[aria-label^="例音"]');
    const field = document.querySelector('#tts-instruct');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '自定义测试：语速适中、吐字清晰、段间停顿。');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until(window, '!document.querySelector(".voice-sample")', '自定义音色清除旧例音');
  assert.ok(await run(window, 'window.previewOldAudio.paused'), '修改音色描述必须停止旧例音');
  assert.equal(await run(window, 'document.querySelector("#tts-text").value'), text, '修改音色描述必须保留文本');
  await run(window, `(() => { const select = document.querySelector('#library-voice'); select.value = ${JSON.stringify(english.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await playing(urls[english.audioPath]);
  report.checks.push('修改音色描述停止并清除旧例音');

  await run(window, 'window.previewOldAudio = document.querySelector(\'audio[aria-label^="例音"]\')');
  await go('声音库');
  await until(window, 'Boolean(document.querySelector(".voice-row"))', '声音库界面');
  assert.ok(await run(window, 'window.previewOldAudio.paused'), '切换页面必须停止合成例音');
  assert.equal(await run(window, 'document.querySelectorAll(".voice-detail audio").length'), 0, '声音库初次打开不得默认选择并播放');
  const libraryVoices = bootstrap.voices.slice(0, 2);
  const rowClick = index => run(window, `document.querySelectorAll('.voice-row')[${index}].click()`);
  for (const voice of libraryVoices) urls[voice.audioPath] = await run(window, `window.studio.getAudioUrl(${JSON.stringify(voice.audioPath)})`);
  await rowClick(0);
  await playing(urls[libraryVoices[0].audioPath]);
  playsBefore = await run(window, 'window.previewEvents.plays.length');
  await rowClick(0);
  await until(window, `window.previewEvents.plays.length > ${playsBefore}`, '同一声音库行重新播放');
  assert.ok((await run(window, 'window.previewEvents.plays.at(-1).time')) < 0.15, '同一声音库行重选必须从头开始');
  await playing(urls[libraryVoices[0].audioPath]);
  const pausesBefore = await run(window, 'window.previewEvents.pauses.length');
  await rowClick(1);
  await playing(urls[libraryVoices[1].audioPath]);
  assert.ok(await run(window, `window.previewEvents.pauses.slice(${pausesBefore}).some(item => item.src === ${JSON.stringify(urls[libraryVoices[0].audioPath])})`), '切换声音必须先暂停旧例音');
  await run(window, 'window.previewOldAudio = document.querySelector(".voice-detail audio")');
  await go('任务记录');
  await wait(100);
  assert.ok(await run(window, 'window.previewOldAudio.paused'), '离开声音库必须停止旧例音');
  report.checks.push('声音库行点击、重复点击、切换停止旧例音和离开页面停止');

  // Only this isolated test process receives delayed/failed URL responses.
  // Real playback above exercised the application's original guarded IPC handler.
  let mode = 'delay-success';
  const received = [];
  ipcMain.removeHandler('studio:getAudioUrl');
  ipcMain.handle('studio:getAudioUrl', async (_event, audioPath) => {
    received.push(audioPath);
    if (mode === 'reject-all') throw new Error('试听验证：音频暂不可读取。');
    if (audioPath === samples[0].audioPath) {
      await wait(350);
      if (mode === 'delay-reject') throw new Error('旧试听请求失败，不应显示。');
    }
    if (!urls[audioPath]) throw new Error('验证声音未注册');
    return urls[audioPath];
  });
  await go('语音合成');
  await until(window, 'Boolean(document.querySelector("#tts-text"))', '返回合成');
  assert.equal(await run(window, 'document.querySelector("#tts-text").value'), text, '浏览声音库后必须保留合成草稿');
  for (mode of ['delay-success', 'delay-reject']) {
    received.length = 0;
    await selectPreset(0);
    for (let attempt = 0; attempt < 100 && !received.includes(samples[0].audioPath); attempt++) await wait(15);
    assert.ok(received.includes(samples[0].audioPath), '必须实际启动延迟请求');
    await selectPreset(1);
    await playing(urls[samples[1].audioPath]);
    await wait(400);
    snapshot = await state();
    assert.equal(snapshot.audio.src, urls[samples[1].audioPath], '旧音频地址不得覆盖最新声音');
    assert.ok(!(await run(window, 'document.querySelector(".voice-sample").textContent')).includes('旧试听请求失败'), '旧请求错误不得覆盖最新试听');
  }
  report.checks.push('延迟旧请求的成功和失败均不会影响最新选择');
  mode = 'reject-all';
  await selectPreset(2);
  await until(window, 'Boolean(document.querySelector(".voice-sample .inline-error"))', '音频读取错误可见');
  assert.ok((await run(window, 'document.querySelector(".voice-sample").textContent')).includes('音频暂不可读取'), '音频读取失败必须明确显示原因');
  report.checks.push('音频失败可见');

  mode = 'delay-success';
  await selectPreset(1);
  await playing(urls[samples[1].audioPath]);
  window.showInactive();
  for (const [width, height, filename] of [[1440, 960, 'desktop.png'], [1050, 760, 'compact.png']]) {
    window.setContentSize(width, height);
    await wait(180);
    assert.equal(await run(window, 'document.documentElement.scrollWidth > innerWidth'), false, '桌面布局不得横向溢出');
    await run(window, 'document.querySelector(".voice-sample").scrollIntoView({ block: "center" })');
    await wait(120);
    assert.ok(await run(window, '(() => { const rect = document.querySelector(".voice-sample").getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })()'), '例音面板必须能够完整显示');
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await fs.writeFile(path.join(checkRoot, filename), image.toPNG());
  }
  report.checks.push('1440 和 1050 宽桌面布局');
  // A deliberately wrong expected source must fail the same observation used above.
  let negativeControl = false;
  try { await playing('studio-audio://audio/known-invalid-negative-control'); }
  catch (error) { negativeControl = error.message.includes('例音实际播放'); }
  assert.ok(negativeControl, '播放检查必须能拒绝错误音源');
  report.negativeControl = negativeControl;
  report.rendererErrors = rendererErrors;
  assert.deepEqual(rendererErrors, [], '界面不得报告 JavaScript 错误');
  assert.equal((await run(window, 'window.studio.getJobs()')).length, bootstrap.jobs.length, '试听不得创建推理任务');
  await fs.writeFile(path.join(checkRoot, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report));
  app.quit();
}

main().catch(error => { console.error(error.stack); app.exit(1); });
setTimeout(() => { console.error('例音试听验证超时'); app.exit(1); }, 90000).unref();
