import React, { useEffect, useRef, useState } from 'react';
import { FileAudio, FolderOpen, Microphone, Stop, CircleNotch, Record, CheckCircle, ArrowRight } from '@phosphor-icons/react';
import { bridge, baseName, AudioPlayer, errorMessage } from './shared.jsx';
import { startRecording } from './recorder.js';
export default function Transcription({ audioPath, setAudioPath, onRecordState, submit, perform, disabled, notify }) {
 const [recording, setRecording] = useState(false);
 const [preparing, setPreparing] = useState(false); const [seconds, setSeconds] = useState(0); const [level, setLevel] = useState(0);
 useEffect(() => { onRecordState(recording); return () => onRecordState(false); }, [recording, onRecordState]);
 const recorder = useRef(null); const timer = useRef(null); const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearInterval(timer.current); recorder.current?.stop(true).catch(() => {}); }; }, []);
 const chooseFile = async () => { const path = await perform(() => bridge.chooseFile('audio')); if (path) setAudioPath(path); };
 const stop = async () => {
  clearInterval(timer.current); setPreparing(true); setRecording(false);
  const active = recorder.current; recorder.current = null;
  try { const bytes = await active?.stop(); if (bytes) { const path = await bridge.saveRecording({ bytes }); if (mounted.current) { setAudioPath(path); notify('录音已保存，可以开始转写。'); } } }
  catch (e) { if (mounted.current) notify(errorMessage(e), 'error'); }
  finally { if (mounted.current) setPreparing(false); }
 };
 const begin = async () => {
  setPreparing(true);
  try {
   const capture = await startRecording(value => { if (mounted.current) setLevel(value); });
   if (!mounted.current) { await capture.stop(true); return; }
   recorder.current = capture; setSeconds(0); setRecording(true);
   timer.current = setInterval(() => setSeconds(value => value + 1), 1000);
  } catch (e) { notify(e.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在系统设置中允许访问，或导入音频文件。' : errorMessage(e), 'error'); }
  finally { if (mounted.current) setPreparing(false); }
 };
 useEffect(() => { if (recording && seconds >= 300) stop(); }, [seconds, recording]);
 return <div className="creation-panel transcription-panel">
  <div className="panel-heading"><span className="section-title"><FileAudio size={21} /><h2>音频输入</h2></span><span className="muted">本地识别</span></div>
  <div className={`upload-zone ${audioPath ? 'has-file' : ''}`}><div className="upload-icon"><FileAudio size={37} weight="duotone" /></div><h3>{audioPath ? baseName(audioPath) : '选择需要转写的音频'}</h3><p>{audioPath ? '原始文件只读，识别结果单独保存。' : '支持 WAV、FLAC、OGG，推荐人声清晰的音频。'}</p><button className="button secondary" disabled={disabled || recording || preparing} onClick={chooseFile}><FolderOpen size={18} />{audioPath ? '更换文件' : '选择音频文件'}</button>{audioPath && <span className="file-path" title={audioPath}>{audioPath}</span>}</div>
  {audioPath && <AudioPlayer path={audioPath} title="输入音频预览" />}
  <div className="record-section"><div><h3><Microphone size={20} />直接录制</h3><p>使用麦克风录制一段声音，最长 5 分钟。</p></div><button className={`button ${recording ? 'recording' : 'secondary'}`} disabled={disabled || preparing} onClick={recording ? stop : begin}>{preparing ? <CircleNotch size={17} className="spin" /> : recording ? <Stop size={17} weight="fill" /> : <Record size={17} />}{preparing ? '处理中' : recording ? '结束录音' : '开始录音'}</button></div>
  {recording && <div className="record-feedback" role="status"><span className="record-dot" /><strong>{Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}</strong><meter min="0" max="0.5" value={level} aria-label="麦克风音量" /><span>正在录音，结束后即可转写</span></div>}
  <div className="asr-info"><CheckCircle size={20} /><div><strong>长音频按片段处理</strong><p>识别完成后保存完整文本与片段时间信息。方言、噪声和多人重叠讲话可能需要人工校对。</p></div></div>
  <div className="submit-row"><span>识别语言由模型自动判断</span><button className="button primary" disabled={disabled || !audioPath || recording || preparing} onClick={async () => { setPreparing(true); try { await submit({ type: 'asr', audioPath }); } finally { if (mounted.current) setPreparing(false); } }}><Microphone size={19} />开始转写<ArrowRight size={17} /></button></div>
 </div>;
}

