const { contextBridge, ipcRenderer } = require('electron');

const invoke = (method, ...args) => ipcRenderer.invoke(`studio:${method}`, ...args);
contextBridge.exposeInMainWorld('studio', Object.freeze({
  getBootstrap: () => invoke('getBootstrap'),
  getSettings: () => invoke('getSettings'),
  saveSettings: (settings) => invoke('saveSettings', settings),
  checkHealth: () => invoke('checkHealth'),
  chooseFile: (kind) => invoke('chooseFile', kind),
  choosePython: (kind) => invoke('choosePython', kind),
  chooseModel: (kind) => invoke('chooseModel', kind),
  saveRecording: (request) => invoke('saveRecording', request),
  submitJob: (request) => invoke('submitJob', request),
  cancelJob: (id) => invoke('cancelJob', id),
  getJobs: () => invoke('getJobs'),
  exportFile: (request) => invoke('exportFile', request),
  revealFile: (file) => invoke('revealFile', file),
  getAudioUrl: (file) => invoke('getAudioUrl', file),
  copyText: (text) => invoke('copyText', text),
  onJob: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('onJob 需要一个回调函数。');
    const listener = (_event, job) => callback(job);
    ipcRenderer.on('studio:job', listener);
    return () => ipcRenderer.removeListener('studio:job', listener);
  },
}));
