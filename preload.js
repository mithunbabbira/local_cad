const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  save: o => ipcRenderer.invoke('save', o), saveTo: o => ipcRenderer.invoke('saveTo', o), open: k => ipcRenderer.invoke('open', k),
  confirm: m => ipcRenderer.invoke('confirm', m), setState: s => ipcRenderer.send('state', s), closeNow: () => ipcRenderer.send('close-now'),
  onMenu: f => ipcRenderer.on('menu', (_, c) => f(c)), onOpenData: f => ipcRenderer.on('open-data', (_, d) => f(d)) });
