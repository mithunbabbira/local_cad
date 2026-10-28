const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs'); const path = require('path');
let win;
function create() {
  win = new BrowserWindow({ width: 1400, height: 900, title: 'LocalCAD',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.loadFile(path.join(__dirname, 'src/index.html'));
  win.webContents.on('console-message', (e, l, m) => process.env.LOCALCAD_SMOKE && console.log('RENDERER', m));
  if (process.env.LOCALCAD_SMOKE) win.webContents.on('did-finish-load', async () => {
    setTimeout(async () => {
      const r = await win.webContents.executeJavaScript('window.__smoke && window.__smoke()');
      console.log('SMOKE_RESULT ' + JSON.stringify(r)); if (process.env.LOCALCAD_SHOT) await new Promise(r => setTimeout(r, 500)); if (process.env.LOCALCAD_SHOT) fs.writeFileSync(process.env.LOCALCAD_SHOT, (await win.webContents.capturePage()).toPNG()); app.exit(r && r.ok ? 0 : 1);
    }, 1500);
  });
}
const send = c => () => win.webContents.send('menu', c);
const tpl = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'File', submenu: [
    { label: 'New', accelerator: 'CmdOrCtrl+N', click: send('new') },
    { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('open') },
    { label: 'Save Project…', accelerator: 'CmdOrCtrl+S', click: send('save') },
    { type: 'separator' },
    { label: 'Import STL/OBJ…', accelerator: 'CmdOrCtrl+I', click: send('import') },
    { label: 'Export STL…', accelerator: 'CmdOrCtrl+E', click: send('exportstl') },
    { label: 'Export OBJ…', click: send('exportobj') }, { type: 'separator' }, { role: 'quit' }] },
  { label: 'Edit', submenu: [
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
    { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
    { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
    { label: 'Group', accelerator: 'CmdOrCtrl+G', click: send('group') },
    { label: 'Ungroup', accelerator: 'CmdOrCtrl+Shift+G', click: send('ungroup') },
    { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }];
app.whenReady().then(() => { Menu.setApplicationMenu(Menu.buildFromTemplate(tpl)); create(); });
app.on('window-all-closed', () => app.quit());
const F = { json: [{ name: 'LocalCAD Project', extensions: ['lcad', 'json'] }],
  stl: [{ name: 'STL', extensions: ['stl'] }], obj: [{ name: 'OBJ', extensions: ['obj'] }] };
ipcMain.handle('save', async (_, { data, kind, name, binary }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: F[kind] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, binary ? Buffer.from(data) : data); return r.filePath;
});
ipcMain.handle('open', async (_, kinds) => {
  const r = await dialog.showOpenDialog(win, { filters: kinds.flatMap(k => F[k]), properties: ['openFile'] });
  if (r.canceled) return null; const p = r.filePaths[0];
  return { path: p, name: path.basename(p), data: fs.readFileSync(p) };
});
