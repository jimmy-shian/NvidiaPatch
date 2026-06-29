const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  hide: () => ipcRenderer.send('window-hide'),
  exit: () => ipcRenderer.send('app-exit'),
  notifyRulesUpdated: () => ipcRenderer.send('rules-updated'),
  getGatewayPort: () => ipcRenderer.sendSync('get-gateway-port'),
  restartGateway: () => ipcRenderer.send('restart-gateway'),
  restartApp: () => ipcRenderer.send('restart-app'),
  isGatewayRunning: () => ipcRenderer.invoke('is-gateway-running'),
  onGatewayRestarted: (callback) => {
    ipcRenderer.on('gateway-restarted', callback);
    return () => ipcRenderer.removeListener('gateway-restarted', callback);
  }
});
