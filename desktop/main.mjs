import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkspace, workspaceId } from './backend.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
app.setName('面试练习室');
app.setPath('userData', resolve(argument('user-data-dir') ?? resolve(app.getPath('appData'), 'interview-room-v2')));
const dataRoot = resolve(argument('data-dir') ?? process.env.INTERVIEW_DATA_DIR ?? (app.isPackaged ? resolve(app.getPath('userData'), 'data') : resolve(root, 'data')));
const port = Number(argument('port') ?? process.env.INTERVIEW_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const url = `http://127.0.0.1:${port}`;
let owned, window, closing = false, quitReady = false;
const local = value => { try { return new URL(value).origin === url; } catch { return false; } };

// The desktop and browser may share a workspace. A service for another data directory is never reused.
async function connectWorkspace() {
  let running;
  try {
    const response = await fetch(url + '/api/bootstrap', { signal: AbortSignal.timeout(1200) });
    if (response.ok) running = await response.json();
  } catch { /* A fresh desktop launch normally starts its own service. */ }
  if (running) {
    if (running.app !== 'interview-room-v2' || running.workspaceId !== workspaceId(dataRoot)) {
      throw new Error(`端口 ${port} 已被其他工作区或旧服务占用。请先关闭对应启动窗口，再重新打开。原数据不会被覆盖。`);
    }
    return;
  }
  owned = await startWorkspace({ port, dataRoot, staticRoot: resolve(root, 'dist') });
}
async function openWindow() {
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 640, show: false,
    title: '面试练习室', backgroundColor: '#f5f7fa', autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (!local(target)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, target) => { if (!local(target)) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = undefined; });
  await window.loadURL(url);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitReady) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void (async () => {
      try { await owned?.close(); } finally { quitReady = true; app.quit(); }
    })();
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '工作区', submenu: [
        { label: '在浏览器打开', click: () => void shell.openExternal(url) },
        { type: 'separator' }, { role: 'quit', label: '退出面试练习室' },
      ] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '视图', submenu: [{ role: 'reload', label: '刷新页面' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] },
    ]));
    await connectWorkspace(); await openWindow();
  }).catch(error => {
    dialog.showErrorBox('面试练习室未能启动', error?.message ?? '请重新启动，已保存的数据会保留。');
    app.quit();
  });
}
