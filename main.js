const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, clipboard, Notification: ElectronNotification } = require('electron');
const path = require('path');
const fs = require('fs');

// 解決 Windows 上 Electron 視窗拖曳卡頓與 GPU 相關的黑屏/閃爍問題
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// 單一實例鎖定（Single Instance Lock），防止重複啟動造成 Port 或系統匣衝突
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[App] Another instance is already running. Quitting this instance.');
  app.quit();
  process.exit(0);
}

const { initDatabase, closeDatabase, rules, settings } = require('./database');
const { createGatewayApp, closeGatewayResources, startGatewayResources } = require('./gateway');

// Gateway 狀態定義
const GatewayState = {
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  ERROR: 'ERROR'
};

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;
let trayMenuUpdateTimer = null;
let gatewayState = GatewayState.STOPPED;
let lastGatewayError = null;

// 1. 載入高質感統一圖示，並保留 16x16 綠色小圖示作為備載
const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVR4nJ2S0Q2AMAhEhXQAXUq30uhWupTdQFMTkoZSjnhfDeX1rgQaDI3n/lj1vGykaxyFe3cUAb007DXd8wof4j/uNUM9WNyn68AJeiow+gZbxQIhZ1GqIaS6RwySLiDpvhQBvIGytZ5RFZblEEmi4S9BxMmbT+OMtlKnbRJ437HuXoAvOsGOPrPFAAAAAElFTkSuQmCC';
const fallbackIcon = nativeImage.createFromBuffer(Buffer.from(iconBase64, 'base64'));
const iconPath = path.join(__dirname, 'icon.png');
const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : fallbackIcon;

// 2. 初始化資料庫 (存放在 AppData/Roaming 目錄下)
const dbPath = path.join(app.getPath('userData'), 'gateway.db');
initDatabase(dbPath);

// 3. Gateway 監聽與連線追蹤
let currentPort = 4000;
const gatewaySockets = new Set();

function loadPortFromDb() {
  try {
    const s = settings.get();
    if (s && s.PORT) {
      currentPort = Number(s.PORT) || 4000;
    }
  } catch (e) {
    console.error('Failed to read PORT from settings cache:', e);
  }
  return currentPort || 4000;
}

// 停用 Node.js 預設 HTTP requestTimeout 限制
function configureServerTimeouts(srv) {
  if (!srv) return;
  srv.requestTimeout = 0;
  srv.headersTimeout = 0;
  srv.keepAliveTimeout = 0;
  srv.timeout = 0;
}

function trackConnections(srv) {
  if (!srv) return;
  configureServerTimeouts(srv);
  srv.on('connection', (socket) => {
    gatewaySockets.add(socket);
    socket.once('close', () => {
      gatewaySockets.delete(socket);
    });
  });
}

// 安全關閉伺服器與其所有連線，徹底釋放 TCP Port
function closeServerAndSockets(cb) {
  closeGatewayResources();

  if (!server) {
    gatewaySockets.clear();
    return cb ? cb() : undefined;
  }

  if (typeof server.closeAllConnections === 'function') {
    try {
      server.closeAllConnections();
    } catch (e) {
      console.error('Error in closeAllConnections:', e);
    }
  }

  for (const socket of gatewaySockets) {
    if (!socket.destroyed) {
      try {
        socket.destroy();
      } catch (e) {
        // ignore
      }
    }
  }
  gatewaySockets.clear();

  try {
    server.close((err) => {
      if (err) {
        console.warn('Notice during server.close:', err.message);
      }
      if (cb) cb();
    });
  } catch (e) {
    if (cb) cb();
  }
}

// 廣播 Gateway 狀態給所有 Renderer 視窗
function broadcastGatewayState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gateway-state-changed', {
      state: gatewayState,
      port: currentPort,
      error: lastGatewayError
    });
    if (gatewayState === GatewayState.RUNNING) {
      mainWindow.webContents.send('gateway-started', { port: currentPort });
    } else if (gatewayState === GatewayState.STOPPED) {
      mainWindow.webContents.send('gateway-stopped');
    }
  }
}

// 啟動 Gateway Server
async function startGatewayServer() {
  if (gatewayState === GatewayState.RUNNING) {
    return { success: true, state: gatewayState, port: currentPort };
  }

  if (gatewayState === GatewayState.STARTING || gatewayState === GatewayState.STOPPING) {
    return { success: false, state: gatewayState, error: 'Gateway 正在執行狀態切換，請稍候再試' };
  }

  gatewayState = GatewayState.STARTING;
  lastGatewayError = null;
  broadcastGatewayState();
  updateTrayMenu();

  const portToUse = loadPortFromDb();

  return new Promise((resolve) => {
    try {
      startGatewayResources();
      const gatewayAppInstance = createGatewayApp();
      const srv = gatewayAppInstance.listen(portToUse, '0.0.0.0', () => {
        server = srv;
        trackConnections(server);
        gatewayState = GatewayState.RUNNING;
        lastGatewayError = null;
        console.log(`[Gateway] Server running on http://0.0.0.0:${portToUse}`);

        broadcastGatewayState();
        updateTrayMenu();

        if (tray) {
          tray.displayBalloon({
            title: 'NVIDIA NIM Gateway',
            content: `Gateway 服務已在埠號 ${portToUse} 啟動。`,
            icon: appIcon
          });
        }

        resolve({ success: true, state: GatewayState.RUNNING, port: portToUse });
      });

      srv.once('error', (err) => {
        console.error('[Gateway] Start failed:', err.message);
        server = null;
        gatewayState = GatewayState.ERROR;
        lastGatewayError = err.message;
        closeGatewayResources();

        broadcastGatewayState();
        updateTrayMenu();

        if (tray) {
          tray.displayBalloon({
            title: 'NVIDIA NIM Gateway 啟動失敗',
            content: `無法在埠號 ${portToUse} 啟動服務：${err.message}`,
            icon: appIcon
          });
        }

        resolve({ success: false, state: GatewayState.ERROR, error: err.message });
      });
    } catch (err) {
      console.error('[Gateway] Exception during start:', err);
      server = null;
      gatewayState = GatewayState.ERROR;
      lastGatewayError = err.message;
      closeGatewayResources();

      broadcastGatewayState();
      updateTrayMenu();

      resolve({ success: false, state: GatewayState.ERROR, error: err.message });
    }
  });
}

// 關閉 Gateway Server
async function stopGatewayServer() {
  if (gatewayState === GatewayState.STOPPED) {
    return { success: true, state: gatewayState };
  }

  if (gatewayState === GatewayState.STARTING || gatewayState === GatewayState.STOPPING) {
    return { success: false, state: gatewayState, error: 'Gateway 正在執行狀態切換，請稍候再試' };
  }

  gatewayState = GatewayState.STOPPING;
  broadcastGatewayState();
  updateTrayMenu();

  return new Promise((resolve) => {
    closeServerAndSockets(() => {
      server = null;
      gatewayState = GatewayState.STOPPED;
      lastGatewayError = null;
      console.log('[Gateway] Server completely stopped. Port and resources released.');

      broadcastGatewayState();
      updateTrayMenu();

      if (tray) {
        tray.displayBalloon({
          title: 'NVIDIA NIM Gateway',
          content: 'Gateway 服務已關閉，已完全釋放埠號與相關資源。',
          icon: appIcon
        });
      }

      resolve({ success: true, state: GatewayState.STOPPED });
    });
  });
}

// 重新啟動 Gateway Server
async function restartGatewayServer() {
  if (gatewayState === GatewayState.STARTING || gatewayState === GatewayState.STOPPING) {
    return { success: false, state: gatewayState, error: 'Gateway 正在執行狀態切換，請稍候再試' };
  }

  if (gatewayState === GatewayState.RUNNING) {
    await stopGatewayServer();
    // 短暫延遲確保作業系統 TCP socket 完全解綁
    await new Promise((r) => setTimeout(r, 100));
  }

  const result = await startGatewayServer();
  if (result.success && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gateway-restarted');
  }
  return result;
}

// 重新啟動整個應用程式
async function restartApp() {
  isQuitting = true;
  if (gatewayState === GatewayState.RUNNING || gatewayState === GatewayState.STARTING) {
    try {
      await stopGatewayServer();
    } catch (_) {}
  }
  closeDatabase();
  app.relaunch();
  app.exit(0);
}

// Windows 開機自動啟動設定
function getAutoStart() {
  if (!app.isPackaged) {
    const s = settings.get();
    return {
      enabled: s?.AUTO_START_ON_BOOT === 'true',
      isPackaged: false
    };
  }
  try {
    const loginSettings = app.getLoginItemSettings({
      path: process.execPath,
      args: ['--hidden']
    });
    return {
      enabled: loginSettings.openAtLogin,
      isPackaged: true
    };
  } catch (err) {
    console.error('Failed to get login item settings:', err);
    return { enabled: false, isPackaged: true };
  }
}

function setAutoStart(enable) {
  try {
    settings.save({ AUTO_START_ON_BOOT: enable ? 'true' : 'false' });
  } catch (err) {
    console.error('Failed to save AUTO_START_ON_BOOT setting:', err);
  }

  if (!app.isPackaged) {
    return {
      success: true,
      enabled: enable,
      isPackaged: false,
      message: '開發環境已儲存設定，打包成 .exe 後將正式註冊 Windows 登入啟動項'
    };
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enable),
      path: process.execPath,
      args: ['--hidden']
    });
    const loginSettings = app.getLoginItemSettings({
      path: process.execPath,
      args: ['--hidden']
    });
    return {
      success: true,
      enabled: loginSettings.openAtLogin,
      isPackaged: true
    };
  } catch (err) {
    console.error('Failed to set login item settings:', err);
    return {
      success: false,
      enabled: false,
      error: err.message,
      isPackaged: true
    };
  }
}

function createMainWindow(isHiddenStartup = false) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: true,
    title: 'NVIDIA NIM LLM Gateway',
    backgroundColor: '#09090b',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    },
    show: false
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (!isHiddenStartup) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon({
          title: 'NVIDIA NIM Gateway',
          content: '服務已最小化至系統列，繼續在背景待命。',
          icon: appIcon
        });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function updateTrayMenu() {
  if (!tray) return;

  setImmediate(() => {
    if (!tray) return;
    let allRules = [];
    try {
      allRules = rules.getAll();
    } catch (err) {
      console.error('Failed to query rules for tray:', err.message);
    }

    const ruleMenuItems = allRules.map(r => ({
      label: `複製 ${r.title.substring(0, 16)}${r.title.length > 16 ? '...' : ''}`,
      click: () => {
        clipboard.writeText(r.content);
        tray.displayBalloon({
          title: '複製成功',
          content: `已成功複製「${r.title}」至剪貼簿！`,
          icon: appIcon
        });
      }
    }));

    const isRunning = gatewayState === GatewayState.RUNNING;
    const isStopped = gatewayState === GatewayState.STOPPED;
    const isStarting = gatewayState === GatewayState.STARTING;
    const isStopping = gatewayState === GatewayState.STOPPING;
    const isError = gatewayState === GatewayState.ERROR;

    const displayPort = loadPortFromDb();
    let statusLabel = '系統狀態: Gateway 已停止';
    if (isRunning) {
      statusLabel = `系統狀態: Gateway 運行中 (埠號 ${displayPort})`;
    } else if (isStarting) {
      statusLabel = '系統狀態: Gateway 啟動中...';
    } else if (isStopping) {
      statusLabel = '系統狀態: Gateway 停止中...';
    } else if (isError) {
      statusLabel = `系統狀態: Gateway 異常 (${lastGatewayError || '請檢查'})`;
    }

    if (tray) {
      if (isRunning) {
        tray.setToolTip(`NVIDIA NIM LLM Gateway (Port ${displayPort}) - 運行中`);
      } else {
        tray.setToolTip('NVIDIA NIM LLM Gateway - 已停止');
      }
    }

    const startLabel = isError ? '▶️ 重新嘗試啟動 Gateway' : '▶️ 啟動 Gateway 服務';
    const canStart = isStopped || isError;
    const canRestart = isRunning;
    const canStop = isRunning;

    const contextMenu = Menu.buildFromTemplate([
      { 
        label: '🖥️ 開啟主畫面', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        } 
      },
      { type: 'separator' },
      {
        label: '📋 快捷複製開發規範',
        submenu: ruleMenuItems.length > 0 ? ruleMenuItems : [{ label: '(無規範紀錄)', enabled: false }]
      },
      { type: 'separator' },
      {
        label: startLabel,
        enabled: canStart,
        click: () => {
          startGatewayServer();
        }
      },
      {
        label: '🔄 重新啟動 Gateway 服務',
        enabled: canRestart,
        click: () => {
          restartGatewayServer();
        }
      },
      {
        label: '⏹️ 關閉 Gateway 服務',
        enabled: canStop,
        click: () => {
          stopGatewayServer();
        }
      },
      { type: 'separator' },
      {
        label: '🔁 重新啟動整個應用程式',
        click: () => {
          restartApp();
        }
      },
      { type: 'separator' },
      { 
        label: statusLabel, 
        enabled: false 
      },
      { type: 'separator' },
      { 
        label: '❌ 結束程式', 
        click: async () => {
          isQuitting = true;
          if (gatewayState === GatewayState.RUNNING || gatewayState === GatewayState.STARTING) {
            try {
              await stopGatewayServer();
            } catch (_) {}
          }
          app.quit();
        } 
      }
    ]);

    tray.setContextMenu(contextMenu);
  });
}

function scheduleTrayMenuUpdate() {
  if (trayMenuUpdateTimer) clearTimeout(trayMenuUpdateTimer);
  trayMenuUpdateTimer = setTimeout(() => {
    trayMenuUpdateTimer = null;
    updateTrayMenu();
  }, 150);
}

function createTray() {
  tray = new Tray(appIcon);
  const displayPort = loadPortFromDb();
  tray.setToolTip(`NVIDIA NIM LLM Gateway (Port ${displayPort})`);
  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 監聽第二個實例啟動（例如已有背景實例時使用者再次雙擊 EXE）
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// IPC 監聽
ipcMain.on('rules-updated', () => {
  console.log('[Tray] Rules database updated. Scheduling Tray context menu rebuild...');
  scheduleTrayMenuUpdate();
});

ipcMain.on('settings-updated', () => {
  console.log('[Tray] Settings updated. Scheduling Tray menu update...');
  scheduleTrayMenuUpdate();
});

ipcMain.on('get-gateway-port', (event) => {
  event.returnValue = loadPortFromDb();
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-hide', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('app-exit', async () => {
  isQuitting = true;
  if (gatewayState === GatewayState.RUNNING || gatewayState === GatewayState.STARTING) {
    try {
      await stopGatewayServer();
    } catch (_) {}
  }
  app.quit();
});

ipcMain.on('restart-gateway', () => {
  restartGatewayServer();
});

ipcMain.on('restart-app', () => {
  restartApp();
});

// Gateway 生命週期 Invoke Handlers
ipcMain.handle('start-gateway', async () => {
  return await startGatewayServer();
});

ipcMain.handle('stop-gateway', async () => {
  return await stopGatewayServer();
});

ipcMain.handle('restart-gateway', async () => {
  return await restartGatewayServer();
});

ipcMain.handle('get-gateway-state', () => {
  return {
    state: gatewayState,
    port: currentPort,
    error: lastGatewayError
  };
});

ipcMain.handle('is-gateway-running', () => {
  return gatewayState === GatewayState.RUNNING && Boolean(server && server.listening);
});

// Windows 開機自啟動 Invoke Handlers
ipcMain.handle('get-auto-start', () => {
  return getAutoStart();
});

ipcMain.handle('set-auto-start', (_event, enable) => {
  return setAutoStart(enable);
});

// 系統通知事件
ipcMain.on('send-notification', (event, { title, body }) => {
  try {
    const notification = new ElectronNotification({
      title,
      body,
      icon: appIcon
    });
    notification.show();
  } catch (err) {
    console.error('Failed to show native notification:', err);
  }
});

// App 生命週期
app.whenReady().then(() => {
  loadPortFromDb();

  const isHiddenStartup = process.argv.includes('--hidden') || 
                          process.argv.includes('--autostart') || 
                          Boolean(app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAtLogin);

  createTray();
  createMainWindow(isHiddenStartup);

  if (isHiddenStartup) {
    console.log('[Startup] Launched in hidden background mode. Gateway server remains STOPPED.');
    gatewayState = GatewayState.STOPPED;
    updateTrayMenu();
  } else {
    console.log('[Startup] Launched in normal mode. Starting Gateway server...');
    startGatewayServer().catch((err) => {
      console.error('[Startup] Failed to start gateway:', err.message);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(false);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (server) {
    closeGatewayResources();
    try {
      server.close();
    } catch (_) {}
    console.log('Gateway Server shut down successfully.');
  }
  closeDatabase();
});


