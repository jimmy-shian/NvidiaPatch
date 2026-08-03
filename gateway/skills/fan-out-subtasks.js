/**
 * fan-out-subtasks Skill 內容內嵌
 *
 * 用途：作為 Gateway 預設注入到 system prompt 的 skill，
 *       讓上游模型在面對可並行的多單元工作時，主動呼叫 agent_manager
 *       工具啟動多個獨立子任務 session 並行執行，加速整體完成。
 *
 * 核心機制：模型本身具備 agent_manager 工具（或等效的 fan-out tool），
 *          可在一次 call 中以 tasks 陣列同時啟動多個獨立 session。
 *          本 skill 教模型何時該用、怎麼拆、怎麼彙整。
 *
 * 同步方式：修改本檔中的字串內容後重新部署 Gateway 即可。
 */

const FAN_OUT_SUBTASKS_SKILL = `# fan-out-subtasks

你具備 "agent_manager" 工具，可以在一次呼叫中同時啟動多個獨立子任務 session 並行執行。面對可並行的工作時，用這個工具加速，不要逐一序列處理。

## 核心觀念

在母任務端等全部子任務完成後彙整結果。這比逐一序列處理快很多。

## 何時使用

符合任一條件即使用：
- 可拆成 2 個以上互不依賴的工作。
- 各 task 有獨立輸入與輸出。
- 可同時查詢、分析、驗證不同來源。

不要使用：
- 有前後依賴 A→B 。
- task 太小，不值得拆。
- 僅有單一工作。

## 拆解原則

每個 task 必須：
- 能獨立完成。
- prompt 自足，包含目標、必要資訊、預期輸出。
- 提供 "name" 與 "branchName"。
- 不共享狀態。

## 安全

- 破壞性操作先停止並預覽影響。
- 需使用者授權的操作暫停並等待確認。`;

module.exports = {
  name: 'fan-out-subtasks',
  content: FAN_OUT_SUBTASKS_SKILL
};
