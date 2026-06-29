const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase, rules } = require('./database');
const { createGatewayApp } = require('./gateway');

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;
let gatewayApp = null;

// 1. 生成 16x16 綠色小圖示的 NativeImage，防止 Tray 圖示遺失
const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVR4nJ2S0Q2AMAhEhXQAXUq30uhWupTdQFMTkoZSjnhfDeX1rgQaDI3n/lj1vGykaxyFe3cUAb007DXd8wof4j/uNUM9WNyn68AJeiow+gZbxQIhZ1GqIaS6RwySLiDpvhQBvIGytZ5RFZblEEmi4S9BxMmbT+OMtlKnbRJ437HuXoAvOsGOPrPFAAAAAElFTkSuQmCC';
const trayIcon = nativeImage.createFromBuffer(Buffer.from(iconBase64, 'base64'));


// 2. 初始化資料庫 (存放在 AppData/Roaming 目錄下)
const dbPath = path.join(app.getPath('userData'), 'gateway.db');
const dbInstance = initDatabase(dbPath);

// 3. 啟動 Gateway Express 伺服器
let portValue = 4000;
try {
  const row = dbInstance.prepare("SELECT value FROM metadata WHERE key = 'PORT'").get();
  if (row && row.value) {
    portValue = Number(row.value) || 4000;
  }
} catch (e) {
  console.error('Failed to read PORT from metadata, using 4000:', e);
}
const PORT = portValue;
let gatewayAppInstance = createGatewayApp();

function restartGateway() {
  if (server) {
    server.close(() => {
      console.log('Gateway Server stopped. Restarting...');
      setTimeout(() => {
        gatewayAppInstance = createGatewayApp();
        server = gatewayAppInstance.listen(PORT, '127.0.0.1', () => {
          console.log(`LLM Gateway Server restarted on http://localhost:${PORT}`);
          if (tray) {
            tray.displayBalloon({
              title: 'NVIDIA NIM Gateway',
              content: 'Gateway 服務已重新啟動。',
              iconType: 'info'
            });
          }
        }).on('error', (err) => {
          console.error('Gateway restart failed:', err.message);
        });
      }, 500);
    });
  } else {
    gatewayAppInstance = createGatewayApp();
    server = gatewayAppInstance.listen(PORT, '127.0.0.1', () => {
      console.log(`LLM Gateway Server started on http://localhost:${PORT}`);
    }).on('error', (err) => {
      console.error('Gateway start failed:', err.message);
    });
  }
}

function restartApp() {
  isQuitting = true;
  app.relaunch();
  app.exit(0);
}

function startServer() {
  server = gatewayAppInstance.listen(PORT, '127.0.0.1', () => {
    console.log(`LLM Gateway Server running on http://localhost:${PORT}`);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: true, // 保留系統邊框以便操作
    title: 'NVIDIA NIM LLM Gateway',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
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
          iconType: 'info'
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
        iconType: 'info'
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
}

function createTray() {
  // 建立系統匣圖示
  tray = new Tray(trayIcon);
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
  console.log('[Tray] Rules database updated. Rebuilding Tray context menu...');
  updateTrayMenu();
});

ipcMain.on('get-gateway-port', (event) => {
  event.returnValue = PORT;
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
  if (mainWindow) {
    mainWindow.webContents.send('gateway-restarted');
  }
});

ipcMain.on('restart-app', () => {
  restartApp();
});

ipcMain.handle('is-gateway-running', () => {
  return server && server.listening;
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
