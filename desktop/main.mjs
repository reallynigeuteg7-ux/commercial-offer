import { app, BrowserWindow, ipcMain, dialog, protocol, session, shell, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStore, blankDocument } from './store.mjs';
import { quoteXls } from './document-xls.mjs';
import { connectedSite } from './site.mjs';
import { sidingRows } from '../lib/crm/documents.mjs';

app.setName('Facade Documents');
app.setAppUserModelId('kz.facade.documents');
protocol.registerSchemesAsPrivileged([{ scheme: 'facade', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window;
let allowClose = false;
const exportedFiles = new Set();
const safeName = value => String(value).split('').map(c => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '-' : c).join('').replace(/[. ]+$/g, '').slice(0, 100) || 'Документ';

if (locked) app.whenReady().then(async () => {
  const directory = path.join(app.getPath('userData'), 'orders');
  const store = createStore(directory);
  const cacheFile = path.join(directory, 'site-orders.json');
  const siteSession = session.fromPartition('persist:facade-site');
  await fs.mkdir(directory, { recursive: true });
  const connection = connectedSite(siteSession, cacheFile, path.join(directory, 'site-access.bin'), safeStorage);
  const assets = path.join(app.getAppPath(), 'ui');
  const allowed = new Map([['/index.html', 'text/html; charset=utf-8'], ['/app.js', 'text/javascript; charset=utf-8'], ['/style.css', 'text/css; charset=utf-8'], ['/logo.svg', 'image/svg+xml']]);
  protocol.handle('facade', async request => {
    const url = new URL(request.url);
    if (url.host !== 'local' || !allowed.has(url.pathname)) return new Response('Not found', { status: 404 });
    return new Response(await fs.readFile(path.join(assets, url.pathname.slice(1))), { headers: { 'Content-Type': allowed.get(url.pathname) } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('facade://local/') && !details.url.startsWith('devtools://') }));
  window = new BrowserWindow({
    width: 1380, height: 940, minWidth: 1020, minHeight: 720,
    icon: path.join(app.getAppPath(), 'brand.ico'), title: 'Facade — КП и ПП', backgroundColor: '#f3f3ed', show: false,
    webPreferences: { preload: path.join(app.getAppPath(), 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== 'facade://local/index.html') event.preventDefault(); });
  const handle = (name, callback) => ipcMain.handle(`documents:${name}`, async (event, ...args) => {
    if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'facade://local/index.html') throw Error('Запрос отклонён.');
    try { return { ok: true, value: await callback(...args) }; }
    catch (e) { return { ok: false, error: e.message || 'Не удалось выполнить действие.', code: e.code }; }
  });
  handle('init', async () => ({ orders: await store.list(), blank: blankDocument(), sidingRows, dataPath: directory }));
  handle('site-cache', async () => { try { return JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } });
  handle('site-sync', () => connection.sync());
  handle('site-login', password => connection.login(password));
  handle('save', input => store.save(input));
  handle('list', () => store.list());
  handle('export', async ({ document, kind }) => {
    const bytes = quoteXls(document, kind);
    const defaultDirectory = path.join(app.getPath('documents'), 'Facade Documents');
    await fs.mkdir(defaultDirectory, { recursive: true });
    const result = await dialog.showSaveDialog(window, {
      title: `Сохранить ${kind.toUpperCase()}`,
      defaultPath: path.join(defaultDirectory, `${kind.toUpperCase()}-${safeName(document.number)}-${safeName(document.title)}.xls`),
      filters: [{ name: 'Excel 97–2003', extensions: ['xls'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const file = result.filePath.toLowerCase().endsWith('.xls') ? result.filePath : `${result.filePath}.xls`;
    await fs.writeFile(file, bytes);
    exportedFiles.add(file);
    return { path: file, name: path.basename(file) };
  });
  handle('open-export', async file => {
    if (!exportedFiles.has(file)) throw Error('Сначала сохраните документ.');
    const error = await shell.openPath(file);
    if (error) throw Error('Файл сохранён. Установите Excel или LibreOffice для его открытия.');
  });
  handle('backup', async () => {
    const result = await dialog.showSaveDialog(window, { title: 'Сохранить резервную копию заказов', defaultPath: path.join(app.getPath('documents'), `Facade-заказы-${blankDocument().date}.json`), filters: [{ name: 'Резервная копия', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, JSON.stringify(await store.backup(), null, 2), 'utf8');
    return result.filePath;
  });
  handle('import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Добавить заказы из резервной копии', properties: ['openFile'], filters: [{ name: 'Резервная копия', extensions: ['json'] }] });
    if (result.canceled) return null;
    if ((await fs.stat(result.filePaths[0])).size > 20 * 1024 * 1024) throw Error('Файл слишком большой.');
    return store.importBackup(JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')));
  });
  handle('folder', () => shell.openPath(directory));
  handle('close', () => { allowClose = true; window.close(); });
  window.on('close', event => {
    if (!allowClose) { event.preventDefault(); window.webContents.send('documents:before-close'); }
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL('facade://local/index.html');
});
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.on('window-all-closed', () => app.quit());

