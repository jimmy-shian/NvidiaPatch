const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, clipboard, Notification: ElectronNotification } = require('electron');
const path = require('path');
const fs = require('fs');

// 解決 Windows 上 Electron 視窗拖曳卡頓與 GPU 相關的黑屏/閃爍問題
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const { initDatabase, rules } = require('./database');
const { createGatewayApp } = require('./gateway');

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;
let gatewayApp = null;
let trayMenuUpdateTimer = null;

// 1. 載入高質感統一圖示，並保留 16x16 綠色小圖示作為備載
const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVR4nJ2S0Q2AMAhEhXQAXUq30uhWupTdQFMTkoZSjnhfDeX1rgQaDI3n/lj1vGykaxyFe3cUAb007DXd8wof4j/uNUM9WNyn68AJeiow+gZbxQIhZ1GqIaS6RwySLiDpvhQBvIGytZ5RFZblEEmi4S9BxMmbT+OMtlKnbRJ437HuXoAvOsGOPrPFAAAAAElFTkSuQmCC';
const fallbackIcon = nativeImage.createFromBuffer(Buffer.from(iconBase64, 'base64'));
const iconPath = path.join(__dirname, 'icon.png');
const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : fallbackIcon;


// 2. 初始化資料庫 (存放在 AppData/Roaming 目錄下)
const dbPath = path.join(app.getPath('userData'), 'gateway.db');
const dbInstance = initDatabase(dbPath);

// 3. 啟動 Gateway Express 伺服器
let currentPort = 4000;
const activeConnections = new Set();

function loadPortFromDb() {
  try {
    const row = dbInstance.prepare("SELECT value FROM metadata WHERE key = 'PORT'").get();
    if (row && row.value) {
      currentPort = Number(row.value) || 4000;
    }
  } catch (e) {
    console.error('Failed to read PORT from database:', e);
  }
  return currentPort;
}

// 追蹤所有連入的 socket 連線，以便重啟時強制關閉
function trackConnections(srv) {
  if (!srv) return;
  srv.on('connection', (socket) => {
    activeConnections.add(socket);
    socket.once('close', () => {
      activeConnections.delete(socket);
    });
  });
}

// 安全關閉伺服器與其所有連線，避免 Keep-Alive/SSE 導致關閉卡死
function closeServerAndSockets(cb) {
  if (!server) return cb();
  
  if (typeof server.closeAllConnections === 'function') {
    try {
      server.closeAllConnections();
    } catch (e) {
      console.error('Error in closeAllConnections:', e);
    }
  }
  
  for (const socket of activeConnections) {
    if (!socket.destroyed) {
      try {
        socket.destroy();
      } catch (e) {
        // ignore
      }
    }
  }
  activeConnections.clear();
  
  server.close(cb);
}

loadPortFromDb();
let gatewayAppInstance = createGatewayApp();

function restartGateway() {
  const portToUse = loadPortFromDb();
  if (server) {
    closeServerAndSockets(() => {
      console.log('Gateway Server stopped. Restarting...');
      setTimeout(() => {
        gatewayAppInstance = createGatewayApp();
        server = gatewayAppInstance.listen(portToUse, '127.0.0.1', () => {
          console.log(`LLM Gateway Server restarted on http://localhost:${portToUse}`);
          if (tray) {
            tray.displayBalloon({
              title: 'NVIDIA NIM Gateway',
              content: `Gateway 服務已在埠號 ${portToUse} 重新啟動。`,
              icon: appIcon
            });
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('gateway-restarted');
          }
        }).on('error', (err) => {
          console.error('Gateway restart failed:', err.message);
        });
        trackConnections(server);
      }, 50);
    });
  } else {
    gatewayAppInstance = createGatewayApp();
    server = gatewayAppInstance.listen(portToUse, '127.0.0.1', () => {
      console.log(`LLM Gateway Server started on http://localhost:${portToUse}`);
    }).on('error', (err) => {
      console.error('Gateway start failed:', err.message);
    });
    trackConnections(server);
  }
}

// 🔁 重新啟動整個應用程式
function restartApp() {
  isQuitting = true;
  app.relaunch();
  app.exit(0);
}

function startServer() {
  const portToUse = loadPortFromDb();
  server = gatewayAppInstance.listen(portToUse, '127.0.0.1', () => {
    console.log(`LLM Gateway Server running on http://localhost:${portToUse}`);
  });
  trackConnections(server);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: true, // 保留系統邊框以便操作
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

  // 判斷是開發環境還是生產環境
  // 開發環境：讀取 Vite Dev Server (預設 5173 埠)
  // 生產環境：讀取打包後的 index.html
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 當用戶點擊「關閉」時，我們將視窗隱藏而不是關閉 (除非觸發 isQuitting)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // 顯示一次系統通知（Windows 特有）
      if (tray) {
        tray.displayBalloon({
          title: 'NVIDIA NIM Gateway',
          content: '服務已最小化至系統列，繼續在背景運行。',
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

    const contextMenu = Menu.buildFromTemplate([
      { 
        label: '開啟主畫面', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        } 
      },
      { type: 'separator' },
      {
        label: '快捷複製開發規範',
        submenu: ruleMenuItems.length > 0 ? ruleMenuItems : [{ label: '(無規範紀錄)', enabled: false }]
      },
      { type: 'separator' },
      {
        label: '🔄 重新啟動 Gateway 服務',
        click: () => {
          restartGateway();
          updateTrayMenu();
        }
      },
      {
        label: '🔁 重新啟動整個應用程式',
        click: () => {
          restartApp();
        }
      },
      { type: 'separator' },
      { 
        label: '系統狀態: 運行中', 
        enabled: false 
      },
      { type: 'separator' },
      { 
        label: '結束程式', 
        click: () => {
          isQuitting = true;
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
  // 建立系統匣圖示
  tray = new Tray(appIcon);
  tray.setToolTip('NVIDIA NIM LLM Gateway');
  updateTrayMenu();

  // 點擊 Tray 圖示時還原視窗
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 監聽來自 Preload 的視窗與規範異動指令
ipcMain.on('rules-updated', () => {
  console.log('[Tray] Rules database updated. Scheduling Tray context menu rebuild...');
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

ipcMain.on('app-exit', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.on('restart-gateway', () => {
  restartGateway();
});

ipcMain.on('restart-app', () => {
  restartApp();
});

ipcMain.handle('is-gateway-running', () => {
  return server && server.listening;
});

// 監聽系統通知事件
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
  startServer();
  createTray();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (server) {
    server.close();
    console.log('Gateway Server shut down successfully.');
  }
});
