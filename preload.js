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
    pick: () => ipcRenderer.invoke('avatar:pick'),
  },
  external: {
    open: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  screenShare: {
    onPickRequest: (callback) => {
      ipcRenderer.on('screenshare:pick-request', (_event, sources) => callback(sources));
    },
    choose: (sourceId) => ipcRenderer.invoke('screenshare:pick-response', sourceId),
  },
});
