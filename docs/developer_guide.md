# Developer Guide (開發人員指南)

本指南說明如何在本機進行開發、測試以及建置/打包 NVIDIA NIM LLM Gateway 桌面應用程式。

---

## 1. 環境需求與安裝
- **Node.js**: 建議使用 v22.5.0 或以上版本（以支援內建的 `node:sqlite` 模組，省去繁瑣的 C++ 編譯）。
- **Python**: 測試需要使用 Python 環境，預設路徑為 `C:\Users\user\venv\Scripts\python.exe`。

在專案根目錄下，使用 PowerShell 執行依賴安裝：
```powershell
npm install
```

---

## 2. 啟動開發模式 (Development Mode)
執行以下指令會同時啟動前端的 Vite 服務、Electron 主視窗，以及在 Port 4000 的背景 Gateway API 服務：
```powershell
npm run dev
```

---

## 3. 啟動生產環境測試 (Production Mode Preview)
在打包前，若想先建置 React 靜態檔案並在 Electron 內以生產模式載入：
```powershell
npm run build
npm start
```

---

## 4. 測試與驗證 (Testing)

### A. 本地自動化 Mock 測試
執行本機整合測試腳本，自動模擬各種網路狀況（如 429、503、401、Timeout 等），並驗證 Gateway 的錯誤處理與金鑰輪替邏輯：
```powershell
node verify-gateway.js
```
*預期輸出：All integration tests passed successfully!*

### B. Python 連線測試
當 Gateway 正在執行時，可以透過 Python 執行端對端測試（非串流與 SSE 串流）：
```powershell
C:\Users\user\venv\Scripts\python.exe test_gateway.py
```
*註：執行前請確認已透過 UI 介面新增至少一組有效的 NVIDIA NIM API Key 並完成模型同步與順序排序。*

---

## 5. 應用程式打包與建置 (Packaging & Distribution)
本專案使用 `electron-builder` 進行打包。

### 📦 Windows 安裝檔打包 (.exe)
```powershell
npm run dist:win
```
- **產出位置**：`release/NvidiaGateway Setup 1.0.0.exe` (或對應的版本號碼)。
- **特點**：NSIS 安裝程式，支援自訂路徑與自動建立桌面捷徑。

### 📦 macOS 安裝檔打包 (.dmg)
```bash
npm run dist:mac
```
- **產出位置**：`release/NvidiaGateway-1.0.0.dmg`。
