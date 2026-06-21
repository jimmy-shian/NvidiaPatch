# NVIDIA NIM LLM Gateway 桌面應用程式 (React + Electron)

這是一個基於 **React + Electron** 的一體化隨插即用桌面應用程式，專為 Cline、OpenCode 以及 VS Code Agent 設計。它在本地啟動一個 OpenAI 兼容的 Gateway API 服務（監聽在 Port 4000），並在背景處理多金鑰輪詢、速率限制（429）自動冷卻、伺服器錯誤（5xx）與超時自動模型降級，並支援縮小至 Windows 系統列（System Tray）持續運行。

**本專案完全擺脫對 Python 與 LiteLLM 的依賴，解決了 Windows 平台下 C++ 編譯環境及第三方庫安裝失敗的問題，達到 100% 隨插即用！**

---

## 1. 核心架構與運作邏輯

```
Cline / OpenCode / Agent
      ↓ (API 請求)
[Local Gateway: Port 4000] (Node.js/Express)
      ↓ (讀寫狀態與統計)
[SQLite 資料庫] (Node.js 內建 node:sqlite)
      ↓ (金鑰輪替 & 模型 Fallback)
NVIDIA NIM Models (integrate.api.nvidia.com)
```

### 💡 錯誤處理與自動化調度規則

1. **429 (Rate Limit)** &rarr; **自動換 Key 重試當前模型**
   - 將該 API Key 在 SQLite 中標記為 `cooldown`（冷卻 30 秒）。
   - 自動挑選下一把健康的 Key **重試相同的模型**。
2. **500 / 502 / 503 / 504 或 Timeout** &rarr; **自動降級至下一順位模型**
   - 記錄此 Key 與模型的錯誤。若單一 Key 連續失敗達 3 次則自動標記為 `inactive`（不健康）。
   - **自動切換至下一順位模型**（例如：第 1 順位失敗 &rarr; 嘗試第 2 順位 &rarr; 嘗試第 3 順位）。
3. **401 / 403 (憑證Revoked/無效)** &rarr; **立刻停用 Key**
   - 自動將該 Key 的狀態改為 `inactive`。更換下一個健康的 Key 重試當前模型。
4. **400 / 404 (用戶端錯誤)** &rarr; **不重試，直接報錯**
   - 直接將錯誤響應回傳給 Cline/OpenCode。
5. **新請求重置優先權**
   - 每次 Cline 發起全新請求時，Gateway **永遠會先從第一順位模型**開始嘗試，確保日常開發優先使用最強模型。

---

## 2. 功能特點

- **📊 實時儀表板**：顯示 Gateway Endpoint、活躍/健康金鑰比例、最近 24 小時流量分佈圖表，以及 **即時活動日誌主控台**（即時顯示每次請求轉發、Key 輪轉與 Fallback 降級日誌）。
- **🔑 金鑰管理池**：支援新增/刪除 API Key，一鍵自動發起連線測試，並在介面上顯示每個 Key 的健康狀態、連續失敗數、總錯誤次數、最後使用時間與最後錯誤原因。
- **🤖 模型排序與自動偵測**：
  - 點擊「同步模型」將利用您健康的 Key 自動向 `https://integrate.api.nvidia.com/v1/models` 動態抓取 NVIDIA NIM 目前提供的所有 Free Endpoint，避免寫死模型列表。
  - 用戶可在 UI 點擊新增至優先級列表，並以「上移/下移」靈活調整第 1、第 2、第 3 順位。
- **📝 Editor Rules 規範快捷鍵**：內建「Angular Commit Message 規範」、「Cline 開發規範」與「UI/UX 設計原則」，支援用戶新增/編輯自訂規範，在 UI 上提供一鍵複製至剪貼簿功能。
- **🚀 隨插即用**：使用 Node.js v24 原生內建的 `node:sqlite` 資料庫，**無需透過 npm 安裝二進制編譯的 SQLite 驅動**，在 Windows 平台上 100% 執行成功。

---

## 3. 安裝與執行

### 開發模式啟動
1. 確保已安裝 Node.js (建議 v22.5.0 以上以支援 `node:sqlite` 內建資料庫)。
2. 在專案目錄下執行安裝依賴：
   ```powershell
   npm install
   ```
3. 執行開發指令：
   ```powershell
   npm run dev
   ```
   此指令會自動啟動 Vite 前端服務並載入 Electron 視窗，並於背景啟動 Port 4000 的 Gateway API。

### 生產模式啟動 (已 Build 靜態檔)
若要直接載入已打包好的前端 React 代碼，可以執行：
```powershell
npm run build
npm start
```

---

## 4. 編輯器設定指引

### Cline 設定
在 Cline 的 Provider 中選擇 `OpenAI Compatible`：
- **Base URL**：`http://localhost:4000/v1`
- **API Key**：任意字串 (如 `dummy-key`)
- **Model ID**：`patcher-main`

### OpenCode 設定
在 `config.json` 中配置：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteLLM-compatible-Gateway",
      "options": {
        "baseURL": "http://localhost:4000/v1"
      },
      "models": {
        "patcher-main": {
          "name": "Patcher Main"
        }
      }
    }
  },
  "model": "litellm/patcher-main"
}
```

---

## 5. 測試與驗證

### A. 自動化本地 Mock 整合測試
本專案內建一個獨立的整合測試腳本 `verify-gateway.js`，它會自動在本地啟動 Mock NVIDIA 伺服器，模擬健康/429/503/401 等各種網路狀況，並自動驗證 Gateway 的對應機制是否正確。
請在終端機中執行：
```powershell
node verify-gateway.js
```
*預期輸出：All integration tests passed successfully!*

### B. Python 測試套件
測試架構遵循規範，整合在單一 Python 檔案中。當 Gateway 服務在背景運行時，可以使用 Python 虛擬環境執行該測試，它會向運作中的 Gateway 真正發送一個非串流與一個 SSE 串流請求，驗證轉發正確性：
```powershell
C:\Users\user\venv\Scripts\python.exe test_gateway.py
```
*註：執行前請先在 UI 中新增至少一把有效的 NVIDIA NIM API Key，並點擊同步模型將優先順序設好。*

---

## 6. 應用程式打包 (Distribution)

本專案使用 `electron-builder` 進行跨平台打包。所有的建置設定都已經在 `package.json` 中配置妥當。

由於跨平台打包的安全與簽章限制，**請在您要產出安裝檔的對應平台上執行打包指令**：

### 📦 Windows 安裝檔打包 (NSIS Installer)
在 Windows 電腦的終端機執行：
```powershell
npm run dist:win
```
- **產出格式**：可在 `release/` 資料夾下找到 `NvidiaGateway Setup 1.0.0.exe`。
- **安裝體驗**：點擊兩下安裝，支持自訂安裝路徑、自動建立桌面與開始功能表捷徑，極易使用。

### 📦 macOS 安裝檔打包 (DMG Image)
在 Mac 電腦的終端機執行：
```bash
npm run dist:mac
```
- **產出格式**：可在 `release/` 資料夾下找到 `NvidiaGateway-1.0.0.dmg`。
- **安裝體驗**：點擊兩下開啟，直接將圖示拖曳到「Applications」即可完成安裝。

