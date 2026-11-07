import React, { useRef, useState } from 'react';
import { SpeakerHigh, Plus, Check, CircleNotch, Waveform, ArrowRight } from '@phosphor-icons/react';
import { LANGUAGES, PRESETS } from './shared.jsx';
import VoiceSample from './VoiceSample.jsx';
export default function Synthesis({ draft, setDraft, voices, submit, disabled }) {
 const { text, name, language, instruct, preset } = draft;
 const update = (key, value) => setDraft(current => ({ ...current, [key]: value }));
 const setText = value => update('text', value);
 const setName = value => update('name', value);
 const setLanguage = value => update('language', value);
 const [submitting, setSubmitting] = useState(false);
 const [preview, setPreview] = useState(null);
 const requestCounter = useRef(0);
 const previewVoice = preview ? preview.voice : voices.find(voice => voice.id === draft.voiceId);
 const selectPreset = item => {
  const voice = voices.find(candidate => candidate.id === item.sampleVoiceId);
  setDraft(current => ({ ...current, instruct: voice?.instruct || voice?.prompt || item.prompt, preset: item.name, voiceId: voice?.id || '' }));
  setPreview({ voice, playRequest: ++requestCounter.current });
 };
 const selectVoice = voice => {
  if (!voice) return;
  setDraft(current => ({ ...current, instruct: voice.instruct || voice.prompt || '', preset: voice.name, language: voice.language || 'Chinese', voiceId: voice.id }));
  setPreview({ voice, playRequest: ++requestCounter.current });
 };
 const onSubmit = async event => { event.preventDefault(); setSubmitting(true); try { await submit({ type: 'tts', text, language, instruct, name: name || '新声音' }); } finally { setSubmitting(false); } };
 return <form className="creation-panel" onSubmit={onSubmit}>
  <div className="panel-heading"><span className="section-title"><SpeakerHigh size={20} /><h2>合成内容</h2></span><span className="muted">从文字开始</span></div>
  <div className="editor-toolbar"><label htmlFor="tts-language">语言<select id="tts-language" value={language} onChange={e => setLanguage(e.target.value)}>{LANGUAGES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="button" className="text-button" onClick={() => setText('欢迎来到语音工作台。每一段文字，都可以拥有属于自己的声音。让我们从这里，开始一次新的创作。')}>填入示例 <Plus size={14} /></button></div>
  <label className="sr-only" htmlFor="tts-text">要合成的文本</label><textarea id="tts-text" className="text-editor" placeholder="在这里写下想说的话…&#10;&#10;一段旁白、一个故事，或一份准备好的文稿。" maxLength={5000} value={text} onChange={e => setText(e.target.value)} required />
  <div className="editor-foot"><span>文本内容应与所选语言一致</span><span>{text.length.toLocaleString()} / 5,000 字符</span></div>
  <div className="voice-design-section"><div className="section-row"><h2>声音设计</h2><span className="muted">用语言，描述你想要的声音</span></div>
   <div className="preset-row">{PRESETS.map(item => <button className={`preset ${preset === item.name ? 'selected' : ''}`} type="button" key={item.name} onClick={() => selectPreset(item)}><span>{item.name}</span><small>{item.scene}</small>{preset === item.name && <Check size={15} />}</button>)}</div>
   <label htmlFor="tts-instruct">音色描述</label><textarea id="tts-instruct" className="prompt-editor" value={instruct} required maxLength={2000} onChange={e => { setDraft(current => ({ ...current, instruct: e.target.value, preset: '自定义', voiceId: '' })); setPreview(null); }} />
   <p className="field-help">建议描述音高、质感、语速、情绪、吐字与停顿。</p>
   <div className="form-row"><div><label htmlFor="voice-name">声音名称 <span className="optional">可选</span></label><input id="voice-name" maxLength={80} placeholder="给这次创作起个名字" value={name} onChange={e => setName(e.target.value)} /></div><div><label htmlFor="library-voice">从声音库复用描述</label><select id="library-voice" value={draft.voiceId || ''} onChange={e => selectVoice(voices.find(item => item.id === e.target.value))}><option value="">选择已有音色</option>{voices.map(voice => <option value={voice.id} key={voice.id}>{voice.name}</option>)}</select></div></div>
   {(preview || previewVoice) && <VoiceSample voice={previewVoice} playRequest={preview?.playRequest || 0} replay={() => setPreview({ voice: previewVoice, playRequest: ++requestCounter.current })} />}
  </div>
  <div className="submit-row"><span><span className="tiny-dot" />生成 WAV，保留文本与音色描述</span><button className="button primary" disabled={disabled || submitting || !text.trim() || !instruct.trim()} type="submit">{submitting ? <CircleNotch className="spin" size={18} /> : <Waveform size={19} />}{submitting ? '提交中' : '生成语音'}<ArrowRight size={17} /></button></div>
 </form>;
}




