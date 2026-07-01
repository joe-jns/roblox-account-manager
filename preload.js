const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('accounts:load'),
  save: (accounts) => ipcRenderer.invoke('accounts:save', accounts),
  export: (accounts) => ipcRenderer.invoke('accounts:export', accounts),
  import: () => ipcRenderer.invoke('accounts:import'),
  resolveGame: (id) => ipcRenderer.invoke('game:resolve', id),
  enrich: (username) => ipcRenderer.invoke('roblox:enrich', username),
  enrichBatch: (usernames) => ipcRenderer.invoke('roblox:enrichBatch', usernames),
  openUrl: (url) => ipcRenderer.invoke('open:url', url),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  version: () => ipcRenderer.invoke('app:version'),
  confirm: (message, buttons) => ipcRenderer.invoke('ui:confirm', { message, buttons }),
});
