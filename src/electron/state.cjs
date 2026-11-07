const fs = require('node:fs');
const path = require('node:path');
const { defaultSettings, validateSettings } = require('./guards.cjs');

class StateStore {
  constructor(directory, projectRoot) {
    this.path = path.join(directory, 'studio-state.json');
    this.data = { settings: defaultSettings(projectRoot), jobs: [] };
    this.warning = null;
    fs.mkdirSync(directory, { recursive: true });
    try {
      const saved = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      this.data.settings = validateSettings({ ...this.data.settings, ...saved.settings });
      this.data.jobs = Array.isArray(saved.jobs) ? saved.jobs : [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const backup = `${this.path}.invalid-${Date.now()}.json`;
        fs.copyFileSync(this.path, backup, fs.constants.COPYFILE_EXCL);
        this.warning = `历史设置读取失败，已使用默认设置。原文件已备份为 ${path.basename(backup)}。`;
      }
    }
  }
  write() {
    const temporary = `${this.path}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporary, this.path);
  }
  settings(value) {
    if (value !== undefined) { this.data.settings = validateSettings(value); this.write(); }
    return structuredClone(this.data.settings);
  }
  jobs(value) { this.data.jobs = value; this.write(); }
}

module.exports = { StateStore };
