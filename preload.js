const { contextBridge, ipcRenderer } = require('electron');
const { SERVER_URL } = require('./shared/constants');

contextBridge.exposeInMainWorld('orbit', {
  serverUrl: SERVER_URL,
  session: {
    load: () => ipcRenderer.invoke('session:load'),
    save: (data) => ipcRenderer.invoke('session:save', data),
    clear: () => ipcRenderer.invoke('session:clear'),
  },
  avatar: {
    pick: (kind) => ipcRenderer.invoke('avatar:pick', kind),
  },
  files: {
    pick: () => ipcRenderer.invoke('files:pick'),
    download: (url) => ipcRenderer.invoke('file:download', url),
  },
  external: {
    open: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  hotkey: {
    onToggleMute: (callback) => ipcRenderer.on('hotkey:toggle-mute', callback),
  },
  update: {
    onStatus: (callback) => ipcRenderer.on('update:status', (_event, payload) => callback(payload)),
    install: () => ipcRenderer.invoke('update:install'),
  },
  screenShare: {
    onPickRequest: (callback) => {
      ipcRenderer.on('screenshare:pick-request', (_event, sources) => callback(sources));
    },
    choose: (sourceId) => ipcRenderer.invoke('screenshare:pick-response', sourceId),
  },
});
