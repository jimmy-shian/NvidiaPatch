const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./database');
const { createGatewayApp } = require('./gateway');

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;

// 1. 生成 16x16 綠色小圖示的 NativeImage，防止 Tray 圖示遺失
const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVR4nJ2S0Q2AMAhEhXQAXUq30uhWupTdQFMTkoZSjnhfDeX1rgQaDI3n/lj1vGykaxyFe3cUAb007DXd8wof4j/uNUM9WNyn68AJeiow+gZbxQIhZ1GqIaS6RwySLiDpvhQBvIGytZ5RFZblEEmi4S9BxMmbT+OMtlKnbRJ437HuXoAvOsGOPrPFAAAAAElFTkSuQmCC';
const trayIcon = nativeImage.createFromBuffer(Buffer.from(iconBase64, 'base64'));


// 2. 初始化資料庫 (存放在 AppData/Roaming 目錄下)
const dbPath = path.join(app.getPath('userData'), 'gateway.db');
initDatabase(dbPath);

// 3. 啟動 Gateway Express 伺服器
const PORT = 4000;
const gatewayApp = createGatewayApp();

function startServer() {
  server = gatewayApp.listen(PORT, '0.0.0.0', () => {
    console.log(`LLM Gateway Server running on http://localhost:${PORT}`);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 760,
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

function createTray() {
  // 建立系統匣圖示
  tray = new Tray(trayIcon);
  
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

  tray.setToolTip('NVIDIA NIM LLM Gateway');
  tray.setContextMenu(contextMenu);

  // 點擊 Tray 圖示時還原視窗
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 監聽來自 Preload 的視窗指令
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
