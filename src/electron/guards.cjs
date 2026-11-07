const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.ogg']);
const LANGUAGES = new Set(['Chinese', 'English', 'Japanese', 'Korean', 'German', 'French', 'Russian', 'Portuguese', 'Spanish', 'Italian', 'Auto']);

function defaultSettings(projectRoot) {
  const pythonPath = (kind) => {
    const windows = `.venv-${kind}/Scripts/python.exe`;
    return fs.existsSync(path.resolve(projectRoot, windows)) ? windows : `.venv-${kind}/bin/python`;
  };
  return {
    ttsPython: pythonPath('tts'),
    asrPython: pythonPath('asr'),
    ttsModel: 'model/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    asrModel: 'model/GLM-ASR-Nano-2512',
    gpuIndex: '0',
  };
}

function boundedText(value, label, max, required = true) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label}必须是文本。`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label}不能为空。`);
  if (result.length > max) throw new Error(`${label}最长 ${max} 个字符。`);
  return result;
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效。');
  const keys = ['ttsPython', 'asrPython', 'ttsModel', 'asrModel', 'gpuIndex'];
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('设置包含不支持的选项。');
  const settings = Object.fromEntries(keys.map((key) => [key, boundedText(value[key], key, 4096)]));
  if (!/^\d{1,3}$/.test(settings.gpuIndex)) throw new Error('GPU 编号应为 0 到 999 的整数。');
  return settings;
}

function resolveRuntime(projectRoot, settings, kind) {
  if (!['tts', 'asr'].includes(kind)) throw new Error('任务类型无效。');
  return {
    python: path.resolve(projectRoot, settings[`${kind}Python`]),
    modelPath: path.resolve(projectRoot, settings[`${kind}Model`]),
    gpuIndex: settings.gpuIndex,
  };
}

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('任务参数无效。');
  if (!['tts', 'asr'].includes(value.type)) throw new Error('仅支持语音合成和语音转文字任务。');
  const request = { type: value.type, name: value.name ? boundedText(value.name, '任务名称', 100) : '' };
  if (value.type === 'tts') {
    request.text = boundedText(value.text, '合成文本', 6000);
    request.instruct = boundedText(value.instruct, '音色描述', 3000);
    request.language = boundedText(value.language || 'Chinese', '语言', 30);
    if (!LANGUAGES.has(request.language) || request.language === 'Auto') throw new Error('请选择支持的合成语言。');
  } else {
    request.audioPath = boundedText(value.audioPath, '音频路径', 4096);
    if (!path.isAbsolute(request.audioPath)) throw new Error('请选择本地音频文件。');
    if (!AUDIO_EXTENSIONS.has(path.extname(request.audioPath).toLowerCase())) throw new Error('请使用 WAV、FLAC 或 OGG 音频。');
    const stat = fs.statSync(request.audioPath, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size === 0) throw new Error('音频文件不存在或为空。');
    request.language = boundedText(value.language || 'Auto', '语言', 30);
    if (!LANGUAGES.has(request.language)) throw new Error('识别语言不受支持。');
  }
  return request;
}

function validateRecording(bytes) {
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('录音数据格式无效。');
  const buffer = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 46 || buffer.length > 100 * 1024 * 1024) throw new Error('录音为空或超过 100 MB。');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) !== buffer.length - 8) throw new Error('录音必须是完整的 WAV 文件。');
  let offset = 12, format = null, dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const content = offset + 8;
    if (content + size > buffer.length) throw new Error('WAV 录音数据不完整。');
    if (name === 'fmt ') {
      if (size < 16) throw new Error('WAV 音频格式无效。');
      format = { encoding: buffer.readUInt16LE(content), channels: buffer.readUInt16LE(content + 2), rate: buffer.readUInt32LE(content + 4), byteRate: buffer.readUInt32LE(content + 8), align: buffer.readUInt16LE(content + 12), bits: buffer.readUInt16LE(content + 14) };
    }
    if (name === 'data') dataSize += size;
    offset = content + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || ![1, 2].includes(format.channels) || format.bits !== 16 || format.rate < 8000 || format.rate > 192000 || format.align !== format.channels * 2 || format.byteRate !== format.rate * format.align || dataSize === 0 || dataSize % format.align !== 0 || offset !== buffer.length) throw new Error('录音需为非空的 16 位 PCM WAV。');
  return buffer;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function allowedFile(projectRoot, candidate, { audioOnly = false } = {}) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) throw new Error('文件路径无效。');
  const canonical = await fs.promises.realpath(candidate);
  const roots = await Promise.all(['outputs', 'voice_design'].map(async (name) => {
    try { return await fs.promises.realpath(path.join(projectRoot, name)); } catch { return null; }
  }));
  if (!roots.some((root) => root && isWithin(root, canonical))) throw new Error('只能打开或导出应用产物与声音库中的文件。');
  const stat = await fs.promises.stat(canonical);
  if (!stat.isFile()) throw new Error('请选择一个文件。');
  if (audioOnly && !AUDIO_EXTENSIONS.has(path.extname(canonical).toLowerCase())) throw new Error('该文件不是支持的音频格式。');
  return canonical;
}

async function canonicalAudioFile(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) throw new Error('音频路径无效。');
  const canonical = await fs.promises.realpath(candidate);
  if (!AUDIO_EXTENSIONS.has(path.extname(canonical).toLowerCase())) throw new Error('请使用 WAV、FLAC 或 OGG 音频。');
  const stat = await fs.promises.stat(canonical);
  if (!stat.isFile() || stat.size === 0) throw new Error('音频文件不存在或为空。');
  return canonical;
}

async function playableAudioFile(projectRoot, candidate, selectedAudio = new Set()) {
  const canonical = await canonicalAudioFile(candidate);
  // Native file-picker consent extends playback only; export and reveal keep their own guard.
  if (selectedAudio.has(canonical)) return canonical;
  return allowedFile(projectRoot, canonical, { audioOnly: true });
}

module.exports = { AUDIO_EXTENSIONS, LANGUAGES, defaultSettings, validateSettings, resolveRuntime, validateRequest, validateRecording, isWithin, allowedFile, canonicalAudioFile, playableAudioFile };
