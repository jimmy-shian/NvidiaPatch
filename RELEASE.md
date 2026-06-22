# Application Release Guide (自動化發布與建置指南)

本專案已整合 GitHub Actions 自動化 CI/CD 發布流程。每當您推送特定版本標籤（例如 `v1.0.0`），GitHub 會自動在背景啟動 Windows 建置流程，並在 GitHub Releases 頁面建立該版本的下載連結，內含自動編譯好的 Windows 安裝檔 (`.exe`)。

---

## 🛠️ 發布新版本步驟 (Release Steps)

當您需要發布一個新版本時，請遵循以下步驟：

### 1. 更新 `package.json` 中的版本號
確認 `package.json` 中的 `"version"` 欄位符合您要發布的新版本（例如 `1.0.1`）：
```json
{
  "name": "nvidia-gateway-app",
  "version": "1.0.1",
  ...
}
```

### 2. 提交代碼並推送到 Git
將變更提交並推送到您的遠端儲存庫主分支（通常為 `master` 或 `main`）：
```powershell
git add package.json
git commit -m "bump: version 1.0.1"
git push origin master
```

### 3. 建立並推送 Git 標籤 (Tag)
標籤格式**必須**以 `v` 開頭（例如 `v1.0.1`），這將觸發 GitHub Actions 的自動化建置：
```powershell
# 建立標籤
git tag v1.0.1

# 將標籤推送到 GitHub
git push origin v1.0.1
```

### 4. 前往 GitHub 檢查進度
1. 開啟您的 GitHub 專案頁面。
2. 點選 **Actions** 分頁，您將看到一個名為 **Build and Release** 的工作流正在執行。
3. 等待建置完成（大約需要 2~4 分鐘）。
4. 建置完成後，前往 **Releases** 頁面，即可看到新建立的 Release 版本以及可供下載的 `.exe` 安裝檔！

---

## ⚠️ 注意事項與權限設定

1. **GitHub 寫入權限 (Workflow Permissions)**:
   GitHub Actions 在發布時需要建立 Release 與上傳檔案的寫入權限。請確認您的 Repo 設定已啟用此權限：
   - 前往 GitHub 專案 `Settings` -> `Actions` -> `General`。
   - 捲動到 **Workflow permissions**，選擇 **Read and write permissions**，然後點選 **Save**。

2. **版本號同步**:
   請務必確保 `package.json` 裡的 `"version"` 版本與 Git 標籤 `v*` 的版號一致，否則 `electron-builder` 編譯出的安裝檔檔名可能會與 Release 的標籤名稱不符。
