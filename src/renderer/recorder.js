/** Encode mono PCM as a browser-independent 16-bit WAV. */
export function encodeWav(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || !samples.length) throw new Error('录音为空，请重新录制。');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('录音采样率无效。');
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}
export async function startRecording(onLevel) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境不支持麦克风录音，请导入音频文件。');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
  let context;
  try {
    context = new AudioContext(); await context.resume();
    const source = context.createMediaStreamSource(stream);
    const capture = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain(); mute.gain.value = 0;
    const chunks = []; let length = 0;
    capture.onaudioprocess = event => {
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(data); length += data.length;
      onLevel?.(Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length));
    };
    source.connect(capture); capture.connect(mute); mute.connect(context.destination);
    let stopped = false;
    return { async stop(discard = false) {
      if (stopped) return null; stopped = true;
      capture.onaudioprocess = null; source.disconnect(); capture.disconnect(); mute.disconnect();
      stream.getTracks().forEach(track => track.stop());
      const sampleRate = context.sampleRate; await context.close();
      if (discard) return null;
      const samples = new Float32Array(length); let offset = 0;
      for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      return encodeWav(samples, sampleRate);
    } };
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') await context.close();
    throw error;
  }
}
