const { randomUUID } = require('node:crypto');
const { validateRequest } = require('./guards.cjs');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const snapshot = (job) => structuredClone(job);

class JobQueue {
  constructor({ run, onChange = () => {}, savedJobs = [], now = () => new Date().toISOString() }) {
    this.run = run;
    this.onChange = onChange;
    this.now = now;
    this.active = null;
    this.stopping = false;
    this.jobs = savedJobs.filter((job) => job && typeof job.id === 'string' && ['tts', 'asr'].includes(job.type)).map((job) => {
      if (!TERMINAL.has(job.status)) return { ...job, status: 'interrupted', finishedAt: now(), error: '上次应用退出时任务尚未完成，请重新提交。' };
      return job;
    });
  }
  list() { return this.jobs.map(snapshot).reverse(); }
  emit(job) { this.onChange(snapshot(job), this.list()); }
  submit(value) {
    if (this.stopping) throw new Error('应用正在退出，暂时不能创建任务。');
    const request = validateRequest(value);
    const job = { id: randomUUID(), type: request.type, status: 'queued', request, createdAt: this.now(), progress: { message: '等待 GPU 空闲' }, logs: [] };
    this.jobs.push(job);
    if (this.jobs.length > 200) {
      const removable = this.jobs.findIndex((item) => TERMINAL.has(item.status));
      if (removable !== -1) this.jobs.splice(removable, 1);
    }
    this.emit(job);
    queueMicrotask(() => this.drain());
    return snapshot(job);
  }
  cancel(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('任务不存在。');
    if (!TERMINAL.has(job.status)) {
      job.status = 'cancelled';
      job.finishedAt = this.now();
      job.progress = { message: '已取消' };
      if (this.active?.job.id === id) this.active.worker?.cancel();
      this.emit(job);
    }
    return snapshot(job);
  }
  shutdown() {
    this.stopping = true;
    for (const job of this.jobs) {
      if (!TERMINAL.has(job.status)) {
        job.status = 'interrupted';
        job.finishedAt = this.now();
        job.error = '应用已退出，请重新提交任务。';
        this.emit(job);
      }
    }
    this.active?.worker?.cancel();
    return this.active?.settled || Promise.resolve();
  }
  drain() {
    if (this.active || this.stopping) return;
    const job = this.jobs.find((item) => item.status === 'queued');
    if (!job) return;
    const active = { job, worker: null, settled: null };
    this.active = active;
    job.status = 'running';
    job.startedAt = this.now();
    job.progress = { message: '正在启动本地模型' };
    this.emit(job);
    active.settled = (async () => {
      try {
        active.worker = this.run(job, (event) => {
          if (job.status !== 'running') return;
          if (event.message) {
            const message = String(event.message).slice(0, 2000);
            job.logs.push(message);
            if (job.logs.length > 80) job.logs.shift();
            if (!event.log) {
              job.progress = { message };
              if (Number.isFinite(event.percent)) job.progress.percent = Math.min(100, Math.max(0, event.percent));
            }
            this.emit(job);
          }
        });
        const result = await active.worker.promise;
        if (job.status === 'running') {
          job.status = 'completed';
          job.result = result;
          job.progress = { message: '已完成', percent: 100 };
        }
      } catch (error) {
        if (job.status === 'running') { job.status = 'failed'; job.error = error.message || String(error); }
      } finally {
        job.finishedAt ||= this.now();
        this.emit(job);
        this.active = null;
        queueMicrotask(() => this.drain());
      }
    })();
  }
}

module.exports = { JobQueue };
