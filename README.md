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
- **⚡ 效能與優化設計**：
  - **SSE 事件節流 (Throttled Real-time Events)**：為了防止高頻率日誌（Logs）與流量狀態（Stats）更新造成 React 畫面頻繁重繪與 CPU 佔用率過高，前端在 `useRealtimeEvents.js` 中實作了 3 秒節流（Throttle）緩衝機制。事件會先暫存並每 3 秒整批更新一次，大幅提升大流量下的前端渲染效能。
  - **批次合併 API 請求 (Cached Initial API Fetching)**：當使用者登入或首頁初始化時，`App.jsx` 會將多個獲取設定、金鑰、模型等 API 請求包裝在同一個 Cache Promise 緩衝中，避免短時間內對 Gateway 重複發起大量相同的併發 Request。

---

## 3. 編輯器設定指引

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

## 4. 開發與發布指引 (Details Toggle)

請展開下方折疊區塊以查看詳細內容：

<details>
<summary><b>🛠️ Tab 1: Engineer/Developer Guide (開發人員與工程師指南)</b></summary>

詳細內容請參閱：[docs/developer_guide.md](docs/developer_guide.md)

### 1. 開發模式啟動
1. 確保已安裝 Node.js (建議 v22.5.0 以上)。
2. 安裝依賴：
   ```powershell
   npm install
   ```
3. 執行開發指令：
   ```powershell
   npm run dev
   ```

### 2. 生產模式啟動 (已 Build 靜態檔)
```powershell
npm run build
npm start
```

### 3. 測試與驗證

#### A. 自動化本地 Mock 整合測試
```powershell
node verify-gateway.js
```

#### B. Python 測試套件
```powershell
C:\Users\user\venv\Scripts\python.exe test_gateway.py
```

### 4. 應用程式打包 (Distribution)

#### 📦 Windows 安裝檔打包 (NSIS Installer)
```powershell
npm run dist:win
```

#### 📦 macOS 安裝檔打包 (DMG Image)
```bash
npm run dist:mac
```
</details>

<details>
<summary><b>🚀 Tab 2: Git tag vXXX release steps (自動化發布與建置指南)</b></summary>

詳細內容請參閱：[docs/release_guide.md](docs/release_guide.md)

### 🛠️ 發布新版本步驟 (Release Steps)

當您需要發布一個新版本時，請遵循以下步驟：

#### 1. 更新 `package.json` 中的版本號
確認 `package.json` 中的 `"version"` 欄位符合您要發布的新版本（例如 `1.0.1`）。

#### 2. 提交代碼並推送到 Git
```powershell
git add package.json
git commit -m "bump: version 1.0.1"
git push origin master
```

#### 3. 建立並推送 Git 標籤 (Tag)
標籤格式**必須**以 `v` 開頭（例如 `v1.0.1`）：
```powershell
git tag v1.0.1
git push origin v1.0.1
```

#### 4. 前往 GitHub 檢查進度
前往 GitHub Actions 頁面確認 **Build and Release** 工作流順利執行完成，並於 Releases 頁面下載打包好的 `.exe` 安裝檔。

#### ⚠️ 注意事項與權限設定
1. **GitHub 寫入權限 (Workflow Permissions)**：確認 Repo 的 Actions 設定已啟用 **Read and write permissions**。
2. **版本號同步**：確保 `package.json` 中的版本與 Git 標籤版本一致。
</details>
