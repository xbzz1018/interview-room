import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 15)) throw new Error('请安装 Node.js 24.15 或更新版本');
const port = Number(process.env.INTERVIEW_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('本机端口需要是 1024–65535 的整数');
const url = `http://127.0.0.1:${port}`;
const dataRoot = resolve(process.env.INTERVIEW_DATA_DIR ?? 'data');
mkdirSync(dataRoot, { recursive: true });
const canonical = realpathSync.native(dataRoot);
const workspace = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
function openApp() {
  console.log(`打开地址：${url}`);
  if (process.env.INTERVIEW_NO_BROWSER === '1') return;
  if (process.platform === 'win32') {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.log(`浏览器未自动打开，请手动访问 ${url}`)); browser.unref();
  }
  else console.log(`打开浏览器：${url}`);
}
async function probe() {
  let value;
  try { const response = await fetch(url + '/api/bootstrap', { signal: AbortSignal.timeout(800) }); value = await response.json(); }
  catch { return false; }
  if (value.app !== 'interview-room-v2' || value.workspaceId !== workspace) throw new Error(`端口 ${port} 已被其他工作区或旧服务占用，请关闭对应启动窗口后重试。`);
  return true;
}
if (await probe()) { console.log('面试练习室已在运行。'); openApp(); process.exit(0); }
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`命令未成功：node ${args[0]}`);
};
if (!existsSync('node_modules/vite/bin/vite.js')) throw new Error('首次使用请在本目录运行 npm ci，再双击启动');
// Rebuild from current source on every fresh launch, so the launcher never serves an old UI.
console.log('正在检查并构建当前界面，请保留这个窗口…');
run(['node_modules/typescript/bin/tsc', '--noEmit']);
run(['node_modules/vite/bin/vite.js', 'build']);
mkdirSync('local_tools', { recursive: true });
const lock = join(dataRoot, 'launcher.lock');
let handle;
try { handle = openSync(lock, 'wx'); }
catch {
  const saved = Number(readFileSync(lock, 'utf8'));
  let alive = false; try { process.kill(saved, 0); alive = true; } catch {}
  if (alive) throw new Error('启动正在进行，请稍等；如未打开，请查看已运行的启动窗口');
  unlinkSync(lock); handle = openSync(lock, 'wx');
}
writeFileSync(handle, String(process.pid)); closeSync(handle);
const child = spawn(process.execPath, ['src/server.ts'], { cwd: root, stdio: 'inherit', windowsHide: true });
let stopped = false;
function cleanup() { try { if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } catch {} }
process.once('exit', cleanup);
function diagnostic(message) {
  console.error(message);
  appendFileSync(join(root, 'local_tools', 'startup.log'), `${new Date().toISOString()} ${message}\n`);
}
child.on('error', error => { stopped = true; diagnostic(`本机服务启动失败：${error.message}`); process.exitCode = 1; });
child.on('exit', code => { stopped = true; cleanup(); if (code) diagnostic(`服务已退出（${code}）。请查看本窗口中的错误，检查端口是否被占用。`); process.exitCode = code ?? 0; });
process.once('SIGINT', () => child.kill()); process.once('SIGTERM', () => child.kill());
let ready = false;
for (let attempt = 0; attempt < 40 && !stopped; attempt++) {
  if (await probe()) { ready = true; console.log('面试练习室已启动。关闭此窗口会停止服务；正式保存的数据会保留。'); openApp(); break; }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!ready && !stopped) { diagnostic(`本机服务未能就绪。请检查端口 ${port}，错误已记录在 local_tools/startup.log。`); child.kill(); process.exitCode = 1; }
