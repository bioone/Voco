import React, { useState } from 'react';
import { Waveform, CircleNotch, WarningCircle, CheckCircle, X, Copy, DownloadSimple, FolderOpen, ClockCounterClockwise } from '@phosphor-icons/react';
import { bridge, Status, AudioPlayer, fmtTime, baseName, activeJob } from './shared.jsx';
export default function TaskPanel({ job, notify, perform }) {
 const [expanded, setExpanded] = useState(false); const result = job?.result;
 const copy = async text => { const done = await perform(() => bridge.copyText(text)); if (done !== null) notify('已复制到剪贴板。'); };
 return <aside className="result-panel"><div className="panel-heading"><h2>任务与结果</h2>{job && <Status status={job.status} />}</div>
  {!job ? <div className="empty-result"><span className="empty-icon"><Waveform size={42} weight="light" /></span><h3>等一个好声音</h3><p>提交任务后，在这里查看进度、试听音频或读取转写结果。</p><div className="result-steps"><span><span>1</span>准备内容</span><span><span>2</span>本地模型处理</span><span><span>3</span>试听与导出</span></div></div> : <div className="result-body">
   <div className="job-name"><strong>{job.type === 'tts' ? job.request.name || '语音合成' : baseName(job.request.audioPath)}</strong><span>{fmtTime(job.createdAt)}</span></div>
   {activeJob(job) && <div className="job-progress"><CircleNotch size={23} className="spin" /><p>{job.progress?.message || '等待模型处理…'}</p>{Number.isFinite(job.progress?.percent) && <progress max="100" value={job.progress.percent} />}<button className="button small secondary" onClick={() => perform(() => bridge.cancelJob(job.id))}><X size={15} />取消任务</button></div>}
   {job.error && <div className="error-box" role="alert"><WarningCircle size={20} /><div><strong>{job.status === 'interrupted' ? '任务已中断' : '任务未完成'}</strong><p>{job.error}</p></div></div>}
   {job.status === 'cancelled' && <p className="muted">任务已取消。已有文件会保留。</p>}
   {result && job.status === 'completed' && <><div className="success-line"><CheckCircle size={18} weight="fill" />{job.type === 'tts' ? '语音生成完成' : '转写完成'}</div>
    {job.type === 'tts' ? <><AudioPlayer path={result.audioPath} /><div className="audio-meta"><span>{Number(result.durationSeconds || 0).toFixed(1)} 秒</span><span>{result.sampleRate ? `${(result.sampleRate / 1000).toFixed(1)} kHz` : 'WAV'}</span><span>WAV</span></div></> : <><label htmlFor={`result-${job.id}`}>转写文本</label><textarea className="transcript-result" id={`result-${job.id}`} value={result.text || ''} readOnly /><button className="text-button" onClick={() => copy(result.text)}><Copy size={15} />复制文本</button>{result.warnings?.length > 0 && <div className="error-box"><WarningCircle size={18} /><div>{result.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div></div>}</>}
    <div className="result-actions"><button className="button primary" onClick={() => perform(() => bridge.exportFile({ path: job.type === 'tts' ? result.audioPath : result.textPath }))}><DownloadSimple size={17} />{job.type === 'tts' ? '导出音频' : '导出文本'}</button><button className="button secondary" onClick={() => perform(() => bridge.revealFile(result.metadataPath || result.audioPath || result.textPath))}><FolderOpen size={17} />查看文件</button></div><p className="field-help">文本与元数据已保存在输出目录。</p></>}
   {job.logs?.length > 0 && <div className="task-log"><button className="text-button" onClick={() => setExpanded(value => !value)}><ClockCounterClockwise size={15} />{expanded ? '收起运行日志' : '查看运行日志'}</button>{expanded && <pre>{job.logs.map(log => typeof log === 'string' ? log : log.message || JSON.stringify(log)).join('\n')}</pre>}</div>}
  </div>}
  <div className="result-tip"><strong>关于本地推理</strong><p>任务将使用 GPU。显存不足时会给出错误，可关闭其他占用显存的程序后重试。</p></div>
 </aside>;
}
