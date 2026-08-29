const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  hide: () => ipcRenderer.send('window-hide'),
  exit: () => ipcRenderer.send('app-exit'),
  notifyRulesUpdated: () => ipcRenderer.send('rules-updated'),
  notifySettingsUpdated: () => ipcRenderer.send('settings-updated'),
  getGatewayPort: () => ipcRenderer.sendSync('get-gateway-port'),

  // Gateway 生命週期控制
  startGateway: () => ipcRenderer.invoke('start-gateway'),
  stopGateway: () => ipcRenderer.invoke('stop-gateway'),
  restartGateway: () => ipcRenderer.invoke('restart-gateway'),
  getGatewayState: () => ipcRenderer.invoke('get-gateway-state'),
  isGatewayRunning: () => ipcRenderer.invoke('is-gateway-running'),

  // Windows 開機自啟動
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enable) => ipcRenderer.invoke('set-auto-start', enable),

  // 應用程式控制與通知
  restartApp: () => ipcRenderer.send('restart-app'),
  sendNotification: (title, body) => ipcRenderer.send('send-notification', { title, body }),

  // 事件監聽
  onGatewayStateChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('gateway-state-changed', listener);
    return () => ipcRenderer.removeListener('gateway-state-changed', listener);
  },
  onGatewayStarted: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('gateway-started', listener);
    return () => ipcRenderer.removeListener('gateway-started', listener);
  },
  onGatewayStopped: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('gateway-stopped', listener);
    return () => ipcRenderer.removeListener('gateway-stopped', listener);
  },
  onGatewayRestarted: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('gateway-restarted', listener);
    return () => ipcRenderer.removeListener('gateway-restarted', listener);
  }
});

