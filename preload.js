const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('accounts:load'),
  save: (accounts) => ipcRenderer.invoke('accounts:save', accounts),
  export: (accounts) => ipcRenderer.invoke('accounts:export', accounts),
  import: () => ipcRenderer.invoke('accounts:import'),
  resolveGame: (id) => ipcRenderer.invoke('game:resolve', id),
  enrich: (username) => ipcRenderer.invoke('roblox:enrich', username),
  openUrl: (url) => ipcRenderer.invoke('open:url', url),
  confirm: (message, buttons) => ipcRenderer.invoke('ui:confirm', { message, buttons }),
});
