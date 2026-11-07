/** Launch the actual packaged EXE from an unrelated cwd; no inference. */
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
async function main() {
 const root = path.resolve(__dirname, '..');
 const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'release', 'win-unpacked');
 const executable = path.join(output, 'qwenASR.exe');
 await fs.access(executable);
 const runs = path.join(root, 'outputs', 'packaged-check');
 const runRoot = path.join(runs, randomUUID());
 const reportFile = path.join(runRoot, 'report.json');
 await fs.mkdir(path.join(runRoot, 'state'), { recursive: true });
 let outputLog = '';
 await new Promise((resolve, reject) => {
  const child = spawn(executable, [], {
   cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
   env: { ...process.env, STUDIO_PACKAGED_CHECK: '1', STUDIO_SMOKE_TEST: '1', STUDIO_USER_DATA_DIR: path.join(runRoot, 'state'), STUDIO_PACKAGED_REPORT: reportFile },
  });
  const timer = setTimeout(() => {
   const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
   killer.once('error', () => child.kill());
   reject(new Error('打包软件验证超过 90 秒；请检查环境或查看报告。'));
  }, 90000);
  const log = data => { outputLog = (outputLog + data.toString('utf8')).slice(-15000); };
  child.stdout.on('data', log); child.stderr.on('data', log);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`打包 EXE 验证退出 ${code}\n${outputLog}`)); });
 });
 const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
 if (report.status !== 'passed' || report.isPackaged !== true || path.resolve(report.execPath) !== path.resolve(executable)) throw new Error('报告未证明真实打包软件启动成功。');
 if (path.resolve(report.paths.projectRoot) !== root || path.resolve(report.paths.appRoot) !== path.join(output, 'resources', 'app')) throw new Error('打包软件代码或数据目录解析错误。');
 if (report.rendererStudio !== true || report.voiceCount < 76 || !report.health?.tts?.capabilities?.tts || !report.health?.asr?.capabilities?.asr) throw new Error('界面、声音库或本地 Python 运行环境验证未通过。');
 await fs.writeFile(path.join(runs, 'report.json'), JSON.stringify({ ...report, testedFrom: os.tmpdir(), outputLog }, null, 2));
 console.log(JSON.stringify({ executable, isPackaged: report.isPackaged, voices: report.voiceCount, tts: true, asr: true, report: path.join(runs, 'report.json') }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

