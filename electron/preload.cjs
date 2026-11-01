const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('focuslens', Object.freeze({
  desktop: true,
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  setApiKey: key => ipcRenderer.invoke('ai:key', key),
  chat: input => ipcRenderer.invoke('ai:chat', input),
}));
