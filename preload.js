const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  save: o => ipcRenderer.invoke('save', o), open: k => ipcRenderer.invoke('open', k),
  onMenu: f => ipcRenderer.on('menu', (_, c) => f(c)) });
