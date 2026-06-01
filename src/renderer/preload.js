'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = ['connection-status', 'connection-error', 'tunnel-log'];

contextBridge.exposeInMainWorld('npvt', {
  getState: () => ipcRenderer.invoke('get-state'),
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  addConfig: (raw) => ipcRenderer.invoke('add-config', raw),
  pasteClipboard: () => ipcRenderer.invoke('paste-clipboard'),
  removeConfig: (id) => ipcRenderer.invoke('remove-config', id),
  updateConfig: (cfg) => ipcRenderer.invoke('update-config', cfg),
  selectConfig: (id) => ipcRenderer.invoke('select-config', id),
  pingConfig: (id) => ipcRenderer.invoke('ping-config', id),
  pingAllConfigs: () => ipcRenderer.invoke('ping-all-configs'),
  pingSelected: () => ipcRenderer.invoke('ping-selected'),
  speedTest: () => ipcRenderer.invoke('speed-test'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', { key, value }),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  on: (channel, callback) => {
    if (!ALLOWED.includes(channel)) return () => {};
    const listener = (_, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
