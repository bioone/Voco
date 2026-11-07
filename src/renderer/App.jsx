import React, { useEffect, useRef, useState } from 'react';
import { Waveform, SpeakerHigh, Microphone, Books, ClockCounterClockwise, GearSix, WarningCircle, CircleNotch, X, CheckCircle, ArrowsClockwise, Cpu } from '@phosphor-icons/react';
import { bridge, errorMessage, PRESETS } from './shared.jsx';
import Synthesis from './Synthesis.jsx';
import Transcription from './Transcription.jsx';
import TaskPanel from './TaskPanel.jsx';
import { VoiceLibrary, History } from './Library.jsx';
import Settings from './Settings.jsx';
const NAV = [['tts', '语音合成', SpeakerHigh], ['asr', '语音转文字', Microphone], ['voices', '声音库', Books], ['history', '任务记录', ClockCounterClockwise]];
const TITLES = {
 tts: ['让文字，拥有声音。', '写下内容，描述音色，用本地模型创造你的声音。'],
 asr: ['把声音，变成文字。', '导入音频或录制一段声音，本地识别并保存转写结果。'],
 voices: ['找到适合的声音。', '试听已有声音，复用音色描述，开始新的创作。'],
 history: ['每一次创作，都有记录。', '查看进度、重新执行任务，或导出已完成的结果。'],
 settings: ['准备好你的工作环境。', '合成和识别使用独立环境，模型与音频都保存在本机。'],
};
export default function App() {
 const [view, setView] = useState('tts');
 const [ttsDraft, setTtsDraft] = useState({ text: '', name: '', language: 'Chinese', instruct: PRESETS[0].prompt, preset: PRESETS[0].name });
 const [audioPath, setAudioPath] = useState('');
 const [recordingActive, setRecordingActive] = useState(false); const [booting, setBooting] = useState(Boolean(bridge));
 const [voices, setVoices] = useState([]); const [jobs, setJobs] = useState([]);
 const [settings, setSettings] = useState(null); const [health, setHealth] = useState(null);
 const [checking, setChecking] = useState(false); const [notice, setNotice] = useState(null);
 const [selectedJobId, setSelectedJobId] = useState(null);
 const noticeTimer = useRef(null);
 const notify = (message, kind = 'success') => {
  clearTimeout(noticeTimer.current); setNotice({ message, kind });
  noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 10000 : 4500);
 };
 useEffect(() => {
  if (!bridge) return;
  let alive = true;
  const unsubscribe = bridge.onJob(job => {
   setJobs(current => [job, ...current.filter(item => item.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
   if (job.status === 'completed' && job.type === 'tts') bridge.getBootstrap().then(data => { if (alive) setVoices(data.voices || []); }).catch(() => {});
  });
  bridge.getBootstrap().then(data => { if (alive) { setSettings(data.settings); setVoices(data.voices || []); setJobs(data.jobs || []); if (data.warning) notify(data.warning, 'error'); } })
   .catch(e => { if (alive) notify(errorMessage(e), 'error'); }).finally(() => { if (alive) setBooting(false); });
  return () => { alive = false; unsubscribe(); clearTimeout(noticeTimer.current); };
 }, []);
 const navigate = next => { if (recordingActive) { notify('请先结束录音，再切换功能。', 'error'); return; } setView(next); };
 const perform = async action => { try { return await action(); } catch (e) { notify(errorMessage(e), 'error'); return null; } };
 const submit = async request => {
  const job = await perform(() => bridge.submitJob(request));
  if (job) { setSelectedJobId(job.id); setJobs(current => current.some(item => item.id === job.id) ? current : [job, ...current]); notify('任务已加入队列。首次加载模型可能需要几分钟。'); }
  return job;
 };
 const checkHealth = async () => {
  setChecking(true);
  try { setHealth(await bridge.checkHealth()); notify('环境检测完成，请在设置中查看详情。'); }
  catch (e) { notify(errorMessage(e), 'error'); } finally { setChecking(false); }
 };
 const useVoice = voice => { setTtsDraft(current => ({ ...current, instruct: voice.instruct || voice.prompt || '', preset: voice.name, language: voice.language || 'Chinese', voiceId: voice.id })); setView('tts'); notify(`已使用「${voice.name}」的音色描述。`); };
 const currentJob = jobs.find(job => job.id === selectedJobId) || jobs.find(job => job.type === view) || jobs[0];
 const running = jobs.find(job => job.status === 'running'); const queued = jobs.filter(job => job.status === 'queued').length;
 const ready = health && health.tts?.capabilities?.tts && health.asr?.capabilities?.asr;
 return <div className="app-shell">
  <aside className="sidebar">
   <div className="brand"><span className="brand-mark"><Waveform size={25} weight="bold" /></span><div><strong>qwenASR</strong><span>语音工作台</span></div></div>
   <div className="nav-group"><span className="nav-label">工作空间</span><nav aria-label="主要功能">{NAV.map(([key, label, Icon]) => <button key={key} className={`nav-item ${view === key ? 'active' : ''}`} onClick={() => navigate(key)} aria-current={view === key ? 'page' : undefined}><Icon size={21} weight={view === key ? 'fill' : 'regular'} /><span>{label}</span>{key === 'history' && queued > 0 && <span className="nav-count">{queued}</span>}</button>)}</nav></div>
   <div className="sidebar-bottom"><div className="local-note"><Cpu size={21} /><div><strong>本地模型 · 本机处理</strong><span>音频无需上传云端</span></div></div><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><GearSix size={21} /><span>环境设置</span></button></div>
  </aside>
  <div className="main-shell">
   <header className="topbar"><div className="breadcrumb">工作空间 <span>/</span> <strong>{NAV.find(item => item[0] === view)?.[1] || '环境设置'}</strong></div><div className="topbar-right"><span className={`runtime-label ${ready ? 'ready' : ''}`}><span className="state-dot" />{running ? '模型正在工作' : health ? ready ? '环境已就绪' : '环境需要检查' : '环境尚未检测'}</span><button className="button small secondary" onClick={checkHealth} disabled={!bridge || checking}><ArrowsClockwise size={15} className={checking ? 'spin' : ''} />{checking ? '检测中' : '检测环境'}</button></div></header>
   <main>
    {!bridge && <div className="preview-banner"><WarningCircle size={18} /><span>界面预览模式。请运行 <code>npm start</code> 打开桌面应用，使用本地模型与文件功能。</span></div>}
    <div className="page-heading"><div><h1>{TITLES[view][0]}</h1><p>{TITLES[view][1]}</p></div><span className="workspace-tag"><Waveform size={17} />语音工作空间</span></div>
    {booting ? <div className="loading"><CircleNotch className="spin" size={24} />正在读取工作空间…</div> : <>
     {view === 'tts' && <div className="workspace-grid"><Synthesis draft={ttsDraft} setDraft={setTtsDraft} voices={voices} submit={submit} disabled={!bridge} /><TaskPanel job={currentJob?.type === 'tts' ? currentJob : jobs.find(job => job.type === 'tts')} notify={notify} perform={perform} /></div>}
     {view === 'asr' && <div className="workspace-grid"><Transcription audioPath={audioPath} setAudioPath={setAudioPath} onRecordState={setRecordingActive} submit={submit} perform={perform} disabled={!bridge} notify={notify} /><TaskPanel job={currentJob?.type === 'asr' ? currentJob : jobs.find(job => job.type === 'asr')} notify={notify} perform={perform} /></div>}
     {view === 'voices' && <VoiceLibrary voices={voices} useVoice={useVoice} perform={perform} />}
     {view === 'history' && <History jobs={jobs} submit={submit} perform={perform} notify={notify} />}
     {view === 'settings' && <Settings settings={settings} setSettings={value => { setSettings(value); setHealth(null); }} health={health} checkHealth={checkHealth} checking={checking} notify={notify} perform={perform} />}
    </>}
    {(view === 'tts' || view === 'asr') && <div className="workspace-footer"><span><Cpu size={15} />{view === 'tts' ? 'Qwen3-TTS · VoiceDesign' : 'GLM-ASR · Nano-2512'}</span><span>{running ? '一个 GPU 任务正在执行' : '任务串行执行，避免模型同时占用显存'}{queued > 0 ? ` · ${queued} 个任务等待中` : ''}</span></div>}
   </main>
  </div>
  {notice && <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'error' ? <WarningCircle size={20} /> : <CheckCircle size={20} />}<span>{notice.message}</span><button className="icon-button" aria-label="关闭通知" onClick={() => setNotice(null)}><X size={18} /></button></div>}
 </div>;
}




