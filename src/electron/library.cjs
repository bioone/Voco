const fs = require('node:fs/promises');
const path = require('node:path');
const { allowedFile, isWithin } = require('./guards.cjs');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if (character === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = (rows.shift() || []).map((name) => name.replace(/^\uFEFF/, ''));
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] || ''])));
}

async function readVoiceLibrary(projectRoot) {
  const libraries = await Promise.all([path.join(projectRoot, 'voice_design'), path.join(projectRoot, 'outputs', 'tts')].map(async (root) => {
    let content;
    try { content = await fs.readFile(path.join(root, 'voice_library.csv'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const canonicalRoot = await fs.realpath(root);
    const libraryFile = async (relative, options) => {
      if (!relative || typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('声音库路径无效。');
      const file = await allowedFile(projectRoot, path.resolve(root, relative), options);
      if (!isWithin(canonicalRoot, file)) throw new Error('声音库文件必须位于对应库目录中。');
      return file;
    };
    return Promise.all(parseCsv(content).map(async (record) => {
      const readText = async (relative) => {
        if (!relative) return '';
        try {
          const file = await libraryFile(relative);
          const stat = await fs.stat(file);
          return stat.size <= 100_000 ? (await fs.readFile(file, 'utf8')).trim() : '';
        } catch { return ''; }
      };
      let audioPath = null;
      try { audioPath = await libraryFile(record.audio_file, { audioOnly: true }); } catch { /* Missing library entries remain visible but disabled. */ }
      const [prompt, text] = await Promise.all([readText(record.prompt_file), readText(record.text_file)]);
      const duration = Number(record.duration_seconds);
      return { ...record, audioPath, prompt, instruct: prompt, text, durationSeconds: Number.isFinite(duration) ? duration : 0 };
    }));
  }));
  return libraries.flat();
}

module.exports = { parseCsv, readVoiceLibrary };
