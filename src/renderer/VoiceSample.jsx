import React from 'react';
import { ArrowsClockwise, SpeakerHigh } from '@phosphor-icons/react';
import { AudioPlayer, bridge, LANGUAGES } from './shared.jsx';
export default function VoiceSample({ voice, playRequest, replay }) {
 if (!voice) return <p className="field-help voice-sample-unavailable">这个声音暂时没有例音，可从声音库选择已有声音试听。</p>;
 return <section className="voice-sample" aria-label="声音例音">
  <div className="voice-sample-heading"><span><SpeakerHigh size={16} /><strong>例音 · {voice.name}</strong><small>{LANGUAGES.find(item => item[0] === voice.language)?.[1] || voice.language}</small></span><button type="button" className="text-button preview-replay" disabled={!bridge || !voice.audioPath} onClick={replay}><ArrowsClockwise size={14} />重新试听</button></div>
  <AudioPlayer path={voice.audioPath} title={`例音 · ${voice.name}`} playRequest={playRequest} />
  {voice.text && <p className="voice-sample-text">{voice.text}</p>}
  <p className="voice-sample-note">播放已有例音；新的合成会根据音色描述生成，可能存在差异。</p>
 </section>;
}
