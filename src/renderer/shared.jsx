import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, WarningCircle, CircleNotch } from '@phosphor-icons/react';
export const bridge = window.studio;
export const LANGUAGES = [['Chinese', '中文'], ['English', 'English'], ['Japanese', '日本語'], ['Korean', '한국어'], ['French', 'Français'], ['German', 'Deutsch'], ['Spanish', 'Español'], ['Portuguese', 'Português'], ['Italian', 'Italiano'], ['Russian', 'Русский']];
export const PRESETS = [
 { name: '温柔叙述', scene: '有声阅读', sampleVoiceId: 'emotion_healing', prompt: '年轻成年女性，音高中等偏高，音色温润柔和，语速舒缓，情绪平静亲切，吐字清晰自然，句间稍作停顿，适合有声书与睡前故事。' },
 { name: '沉稳旁白', scene: '影片解说', sampleVoiceId: 'movie_narrator_male', prompt: '中年男性，音高中低，质感低沉浑厚，语速适中，情绪克制但有故事感，咬字清晰有力，重点词略加重，段落间留出停顿，适合纪录片旁白。' },
 { name: '清晰讲解', scene: '知识科普', sampleVoiceId: 'knowledge_professional_female', prompt: '成年女性，音高中等，音色明亮干净，语速适中偏慢，情绪专注耐心，专业术语吐字准确，逻辑转折处停顿，适合课程和知识科普。' },
];
export const LABELS = { queued: '等待中', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
export const fmtTime = value => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
export const baseName = path => path?.split(/[\\/]/).pop() || '';
export const activeJob = job => ['queued', 'running'].includes(job.status);
export const errorMessage = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export function Status({ status }) {
 const Icon = status === 'completed' ? CheckCircle : status === 'failed' || status === 'interrupted' ? WarningCircle : status === 'running' ? CircleNotch : null;
 return <span className={`status status-${status}`}>{Icon && <Icon size={14} className={status === 'running' ? 'spin' : ''} />}{LABELS[status] || status}</span>;
}
export function AudioPlayer({ path, title = '音频试听', playRequest = 0 }) {
 const [source, setSource] = useState(null);
 const [error, setError] = useState('');
 const audioRef = useRef(null);
 const generation = useRef(0);
 useEffect(() => {
  const request = ++generation.current;
  let alive = true;
  const element = audioRef.current;
  setError(''); setSource(null);
  if (path && bridge) bridge.getAudioUrl(path).then(url => {
   if (alive) setSource({ path, playRequest, url, request });
  }).catch(e => { if (alive) setError(errorMessage(e)); });
  return () => {
   alive = false;
   if (element) { element.pause(); element.removeAttribute('src'); element.load(); }
  };
 }, [path, playRequest]);
 const validSource = source?.path === path && source?.playRequest === playRequest;
 const sourceUrl = validSource ? source.url : undefined;
 const beginPreview = event => {
  if (!playRequest || !validSource || generation.current !== source.request || audioRef.current !== event.currentTarget) return;
  const element = event.currentTarget;
  const request = source.request;
  element.currentTime = 0;
  element.play().catch(e => {
   if (generation.current === request && audioRef.current === element && e.name !== 'AbortError') {
    setError(e.name === 'NotAllowedError' ? '自动试听被阻止，请点击播放器的播放按钮。' : '例音暂时无法播放，请重新试听或检查音频文件。');
   }
  });
 };
 return <div className="audio-player">
  {!path ? <p className="inline-error">音频文件缺失，请检查声音库记录。</p> : !bridge ? <p className="field-help">请在桌面应用中试听声音例音。</p> : <>
   {error && <p className="inline-error" role="alert">{error}</p>}
   <audio key={`${path}:${playRequest}`} ref={audioRef} controls preload="metadata" src={sourceUrl} aria-label={title} onLoadedMetadata={beginPreview} onPlay={event => { for (const other of document.querySelectorAll('audio')) if (other !== event.currentTarget) other.pause(); }} onError={() => { if (sourceUrl) setError('无法播放音频，请检查文件是否存在或重新试听。'); }} />
  </>}
 </div>;
}

