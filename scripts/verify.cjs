const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const run = (command, args) => {
 const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
 if (result.error || result.status !== 0) { console.error(result.error?.message || `验证失败，退出代码 ${result.status}`); process.exit(1); }
};
for (const file of fs.readdirSync(path.join(root, 'src/electron')).filter(name => name.endsWith('.cjs'))) run(process.execPath, ['--check', path.join('src/electron', file)]);
const nodeTests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).map(name => path.join('tests', name));
run(process.execPath, ['--test', ...nodeTests]);
for (const env of ['.venv-tts', '.venv-asr']) {
 const python = path.join(root, env, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
 if (!fs.existsSync(python)) { console.error(`缺少 ${env} 的 Python，请先配置项目运行环境。`); process.exit(1); }
 run(python, ['-m', 'compileall', '-q', 'src/backend', 'src/tts', 'src/asr', 'tests/test_backend.py']);
 run(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_backend.py']);
}
run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.config.js']);
console.log('静态检查、最小功能测试和 React 构建均通过；此命令不加载模型。');
