/** Refresh application code without replacing Electron, runtime settings or user data. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
async function updateUnpacked(root = path.resolve(__dirname, '..')) {
 const releaseRoot = path.join(root, 'release');
 const packageRoot = path.join(releaseRoot, 'win-unpacked');
 const target = path.join(packageRoot, 'resources', 'app', 'dist');
 const expected = path.resolve(target);
 if (await fs.realpath(target) !== expected) throw new Error('unpacked 界面目录被重定向，拒绝覆盖。');
 const metadataFile = path.join(packageRoot, 'build-info.json');
 const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
 const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'resources', 'app', 'package.json'), 'utf8'));
 if (metadata.product !== 'qwen-speech-studio' || manifest.name !== metadata.product || manifest.main !== 'src/electron/main.cjs') throw new Error('此目录不是本项目创建的 unpacked 软件。');
 const source = path.join(root, 'dist');
 const index = await fs.readFile(path.join(source, 'index.html'));
 const oldIndex = path.join(target, 'index.html');
 const backup = path.join(target, `index.html.previous-${randomUUID()}`);
 await fs.copyFile(oldIndex, backup, fs.constants.COPYFILE_EXCL);
 // Content-hashed assets coexist with the previous bundle, so an open window keeps working.
 for (const entry of await fs.readdir(source)) {
  if (entry !== 'index.html') await fs.cp(path.join(source, entry), path.join(target, entry), { recursive: true });
 }
 const temporaryIndex = path.join(target, `.index-${randomUUID()}.tmp`);
 await fs.writeFile(temporaryIndex, index, { flag: 'wx' });
 await fs.rename(temporaryIndex, oldIndex);
 const desktopTarget = path.join(packageRoot, 'resources', 'app', 'src', 'electron');
 if (await fs.realpath(desktopTarget) !== path.resolve(desktopTarget)) throw new Error('桌面代码目录被重定向，拒绝覆盖。');
 for (const file of await fs.readdir(path.join(root, 'src', 'electron'))) {
  if (file.endsWith('.cjs')) await fs.copyFile(path.join(root, 'src', 'electron', file), path.join(desktopTarget, file));
 }
 const temporaryMetadata = `${metadataFile}.${randomUUID()}.tmp`;
 await fs.writeFile(temporaryMetadata, JSON.stringify({ ...metadata, rendererUpdatedAt: new Date().toISOString(), rendererFeature: 'voice sample previews' }, null, 2), { flag: 'wx' });
 await fs.rename(temporaryMetadata, metadataFile);
 return { executable: path.join(packageRoot, 'qwenASR.exe'), backup };
}
if (require.main === module) updateUnpacked().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { updateUnpacked };

