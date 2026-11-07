const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');

// Library output is treated as a log; only the documented JSON envelope can finish a job.
class LineProtocol {
  constructor(onEvent) {
    this.decoder = new StringDecoder('utf8');
    this.pending = '';
    this.onEvent = onEvent;
  }
  push(chunk) {
    this.pending += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (this.pending.length > 2_000_000) throw new Error('Python 输出行过长，无法安全读取。');
    let end;
    while ((end = this.pending.indexOf('\n')) !== -1) {
      this.line(this.pending.slice(0, end));
      this.pending = this.pending.slice(end + 1);
    }
  }
  end() {
    this.pending += this.decoder.end();
    if (this.pending) this.line(this.pending);
    this.pending = '';
  }
  line(raw) {
    const line = raw.trim();
    if (!line) return;
    try {
      const event = JSON.parse(line);
      if (event && ['progress', 'result', 'error'].includes(event.type)) {
        this.onEvent(event);
        return;
      }
    } catch { /* Third-party inference libraries also write ordinary text. */ }
    this.onEvent({ type: 'progress', message: line.slice(0, 2000), log: true });
  }
}

function stopProcessTree(child, spawnProcess = spawn, platform = process.platform) {
  if (!child?.pid || child.exitCode !== null) return;
  if (platform === 'win32') {
    const killer = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.once('error', () => child.kill());
    killer.once('exit', (code) => { if (code !== 0) child.kill(); });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 3000);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }
}

function runPythonWorker({ projectRoot, backendRoot, runtime, payload, onEvent = () => {}, timeoutMs = 0, spawnProcess = spawn, platform = process.platform }) {
  let child;
  let cancelled = false;
  let timeout;
  let result;
  let errorMessage;
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve(value);
    };
    try {
      const arguments_ = backendRoot ? ['-u', path.join(backendRoot, 'run_worker.py')] : ['-u', '-m', 'src.backend.worker'];
      child = spawnProcess(runtime.python, arguments_, {
        cwd: projectRoot,
        env: { ...process.env, QWEN_STUDIO_PROJECT_ROOT: projectRoot, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, detached: platform !== 'win32',
      });
    } catch (error) { finish(error); return; }
    const protocol = new LineProtocol((event) => {
      if (event.type === 'result') result = event.result;
      else if (event.type === 'error') errorMessage = String(event.message || 'Python 任务失败。');
      onEvent(event);
    });
    const stderr = new LineProtocol((event) => onEvent({ type: 'progress', message: String(event.message || JSON.stringify(event.result) || '').slice(0, 2000), log: true }));
    child.stdout.on('data', (chunk) => {
      try { protocol.push(chunk); } catch (error) { errorMessage = error.message; stopProcessTree(child, spawnProcess, platform); }
    });
    child.stderr.on('data', (chunk) => {
      try { stderr.push(chunk); } catch (error) { errorMessage = error.message; stopProcessTree(child, spawnProcess, platform); }
    });
    child.once('error', (error) => finish(new Error(`无法启动 Python：${error.message}。请在设置中检查解释器路径。`)));
    child.stdin.on('error', (error) => { errorMessage ||= `无法发送任务参数：${error.message}`; });
    child.once('close', (code) => {
      protocol.end();
      stderr.end();
      if (cancelled) finish(new Error('任务已取消。'));
      else if (errorMessage) finish(new Error(errorMessage));
      else if (code !== 0) finish(new Error(`Python 进程退出（代码 ${code}），请查看任务日志。`));
      else if (result === undefined) finish(new Error('Python 未返回结果，请查看任务日志。'));
      else finish(null, result);
    });
    child.stdin.end(`${JSON.stringify({ ...payload, model_path: runtime.modelPath, gpu_index: runtime.gpuIndex })}\n`, 'utf8');
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        errorMessage = '环境检查超时，请检查 Python 环境与驱动。';
        stopProcessTree(child, spawnProcess, platform);
      }, timeoutMs);
      timeout.unref();
    }
  });
  return { promise, cancel() { cancelled = true; stopProcessTree(child, spawnProcess, platform); } };
}

module.exports = { LineProtocol, stopProcessTree, runPythonWorker };
