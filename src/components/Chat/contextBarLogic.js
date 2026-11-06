/**
 * Context 用量列收合決策（純函式，方便單元測試）。
 *
 * 對話視窗有三個機制會互相牽動，需要互不干擾：
 * 1. Context 列收合／展開（本函式）
 * 2. 右側對話位置標籤（scroll rail markers）
 * 3. 捲動吸附／錨定（overflow-anchor 與串流自動跟隨）
 *
 * 規則：
 * - 僅在使用者「主動向上捲動」且已離開最新訊息一段距離時收合
 * - 回到最新訊息附近（<= EXPAND 距離）時展開，兩門檻間保留遲滯，避免收合
 *   改變視窗高度後又立刻觸發展開的震盪迴圈
 * - 程式捲動（位置標籤跳轉、回到底部按鈕）期間一律維持現狀：收合補償會
 *   寫入 scrollTop，會中斷瀏覽器進行中的平滑捲動，讓跳轉落點跑掉
 */

export const CONTEXT_COLLAPSE_DISTANCE = 80;
export const CONTEXT_EXPAND_DISTANCE = 25;

export function nextContextBarCollapsed({
  collapsed,
  scrollTop,
  prevScrollTop,
  distanceFromBottom,
  isProgrammatic = false
}) {
  if (isProgrammatic) return collapsed;
  const scrolledUp = scrollTop < prevScrollTop - 1;
  if (scrolledUp && distanceFromBottom > CONTEXT_COLLAPSE_DISTANCE) return true;
  if (distanceFromBottom <= CONTEXT_EXPAND_DISTANCE) return false;
  return collapsed;
}
