const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs'); const path = require('path');
let win, dirty = false, forceClose = false, pendingOpen = null;
function create() {
  win = new BrowserWindow({ width: 1400, height: 900, title: 'Untitled — LocalCAD', icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.loadFile(path.join(__dirname, 'src/index.html'));
  win.on('close', e => {
    if (!dirty || forceClose) return; e.preventDefault();
    const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'Do you want to save the changes to your design?', detail: "Your changes will be lost if you don't save them." });
    if (r === 0) win.webContents.send('menu', 'save-and-close'); else if (r === 1) { forceClose = true; win.close(); }
  });
  win.webContents.on('console-message', (e, l, m) => process.env.LOCALCAD_SMOKE && console.log('RENDERER', m));
  win.webContents.on('did-finish-load', async () => {
    const f = pendingOpen || process.argv.slice(1).find(a => /\.lcad$/i.test(a)); if (f) { pendingOpen = null; openPath(f); }
    if (!process.env.LOCALCAD_SMOKE) return;
    let r; try { r = await win.webContents.executeJavaScript('window.__smoke()'); } catch (e) { r = { ok: false, error: String(e.message) }; }
    if (r && r.ok && !fs.existsSync('/tmp/localcad-smoke.lcad')) { r.ok = false; r.error = 'save file missing'; }
    console.log('SMOKE_RESULT ' + JSON.stringify(r));
    if (process.env.LOCALCAD_SHOT) { await win.webContents.executeJavaScript('window.__shotScene()'); fs.writeFileSync(process.env.LOCALCAD_SHOT, (await win.webContents.capturePage()).toPNG()); }
    app.exit(r && r.ok ? 0 : 1);
  });
}
function openPath(p) { try { win.webContents.send('open-data', { path: p, name: path.basename(p), data: fs.readFileSync(p) }); } catch (e) { dialog.showErrorBox('Could not open', String(e.message)); } }
// macOS: double-clicked .lcad files / dropped on the dock icon
app.on('open-file', (e, p) => { e.preventDefault(); if (win && !win.webContents.isLoading()) openPath(p); else pendingOpen = p; });
const send = c => () => win && win.webContents.send('menu', c);
const item = (label, accelerator, c) => ({ label, accelerator, click: send(c) });
const tpl = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'File', submenu: [item('New', 'CmdOrCtrl+N', 'new'), item('Open…', 'CmdOrCtrl+O', 'open'), { type: 'separator' },
    item('Save', 'CmdOrCtrl+S', 'save'), item('Save As…', 'CmdOrCtrl+Shift+S', 'saveas'), { type: 'separator' },
    item('Import STL/OBJ…', 'CmdOrCtrl+I', 'import'), item('Export STL…', 'CmdOrCtrl+E', 'exportstl'), item('Export OBJ…', 'CmdOrCtrl+Shift+E', 'exportobj'),
    { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
  { label: 'Edit', submenu: [item('Undo', 'CmdOrCtrl+Z', 'undo'), item('Redo', 'CmdOrCtrl+Shift+Z', 'redo'), { type: 'separator' },
    item('Cut', 'CmdOrCtrl+X', 'cut'), item('Copy', 'CmdOrCtrl+C', 'copy'), item('Paste', 'CmdOrCtrl+V', 'paste'), item('Duplicate', 'CmdOrCtrl+D', 'duplicate'),
    item('Select All', 'CmdOrCtrl+A', 'selectall'), { type: 'separator' },
    item('Group', 'CmdOrCtrl+G', 'group'), item('Ungroup', 'CmdOrCtrl+Shift+G', 'ungroup'),
    item('Lock / Unlock', 'CmdOrCtrl+L', 'lock'), item('Hide', 'CmdOrCtrl+Shift+H', 'hide'), item('Show All', 'CmdOrCtrl+Shift+A', 'showall')] },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }];
app.whenReady().then(() => { Menu.setApplicationMenu(Menu.buildFromTemplate(tpl)); create(); });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) create(); });
const F = { json: [{ name: 'LocalCAD Project', extensions: ['lcad', 'json'] }],
  stl: [{ name: 'STL', extensions: ['stl'] }], obj: [{ name: 'OBJ', extensions: ['obj'] }] };
ipcMain.handle('save', async (_, { data, kind, name, binary }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: F[kind] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, binary ? Buffer.from(data) : data); return r.filePath;
});
ipcMain.handle('saveTo', async (_, { data, filePath }) => { fs.writeFileSync(filePath, data); return filePath; });
ipcMain.handle('open', async (_, kinds) => {
  const r = await dialog.showOpenDialog(win, { filters: kinds.flatMap(k => F[k]), properties: ['openFile'] });
  if (r.canceled) return null; const p = r.filePaths[0];
  return { path: p, name: path.basename(p), data: fs.readFileSync(p) };
});
ipcMain.handle('confirm', async (_, message) => dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Discard', 'Cancel'], defaultId: 1, cancelId: 1, message }) === 0);
ipcMain.on('state', (_, s) => { dirty = !!s.dirty; win.setTitle(s.title); if (win.setDocumentEdited) win.setDocumentEdited(dirty); if (s.filePath && win.setRepresentedFilename) win.setRepresentedFilename(s.filePath); });
ipcMain.on('close-now', () => { forceClose = true; win.close(); });
