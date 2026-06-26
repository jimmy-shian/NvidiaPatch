const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  hide: () => ipcRenderer.send('window-hide'),
  exit: () => ipcRenderer.send('app-exit'),
  notifyRulesUpdated: () => ipcRenderer.send('rules-updated'),
  getGatewayPort: () => ipcRenderer.sendSync('get-gateway-port')
});
