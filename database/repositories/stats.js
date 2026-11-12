const { getTaiwanHourString } = require('../../utils/date');

// Process-level in-memory storage for volatile runtime request statistics
const MAX_HOURLY_BUCKETS = 48;
// 已追蹤的請求結果上限（有界記憶體管理，避免長時間執行後無限增長）
const MAX_TRACKED_REQUESTS = 2000;

// requestId -> 'success' | 'error'
// 用來避免「同一個客戶端請求因模型重試而重複計入統計」造成錯誤數暴增。
const requestOutcomeMap = new Map();

const runtimeCounters = {
  totalRequests: 0,
  successRequests: 0,
  errorRequests: 0
};

// Map: hourStr (YYYY-MM-DD HH:00) -> { hour, request_count, success_count, error_count }
const hourlyStatsMap = new Map();

/**
 * 追蹤單一請求的結果，判定本次呼叫應該如何影響統計計數。
 *
 * @returns {'record'|'upgrade'|'skip'}
 *  - record：首次記錄，正常累加計數
 *  - upgrade：先前已記為失敗、此刻改為成功 → 僅將失敗轉為成功，總數不變
 *  - skip：此請求已完成記錄，忽略後續呼叫
 */
function trackRequestOutcome(requestId, isSuccess) {
  const prior = requestOutcomeMap.get(requestId);

  if (prior === 'success') return 'skip';

  if (prior === 'error') {
    if (isSuccess) {
      requestOutcomeMap.set(requestId, 'success');
      return 'upgrade';
    }
    return 'skip';
  }

  requestOutcomeMap.set(requestId, isSuccess ? 'success' : 'error');

  // 有界記憶體管理：超過上限時刪除最舊的追蹤項目
  while (requestOutcomeMap.size > MAX_TRACKED_REQUESTS) {
    const oldestKey = requestOutcomeMap.keys().next().value;
    requestOutcomeMap.delete(oldestKey);
  }

  return 'record';
}

const stats = {
  /**
   * 取得最近 24 小時的請求統計（時間由舊到新排序）
   */
  getHourlyStats: () => {
    const all = Array.from(hourlyStatsMap.values());
    return all.slice(-24);
  },

  /**
   * 取得總體運行時計數
   */
  getStats: () => {
    return { ...runtimeCounters };
  },

  /**
   * 記錄單次請求（成功或失敗）— 100% 純記憶體累加，0 次磁碟寫入
   *
   * @param {boolean} isSuccess
   * @param {string|null} requestId - 若提供，同一 requestId 只會被計入一次統計
   */
  recordRequest: (isSuccess, requestId = null) => {
    let mode = 'record';
    if (requestId) {
      mode = trackRequestOutcome(requestId, isSuccess);
      if (mode === 'skip') return;
    }

    const hourStr = getTaiwanHourString();
    let entry = hourlyStatsMap.get(hourStr);
    if (!entry) {
      entry = {
        id: hourlyStatsMap.size + 1,
        hour: hourStr,
        request_count: 0,
        success_count: 0,
        error_count: 0
      };
      hourlyStatsMap.set(hourStr, entry);

      // 有界記憶體管理：超過上限時刪除最舊的小時區間
      while (hourlyStatsMap.size > MAX_HOURLY_BUCKETS) {
        const oldestKey = hourlyStatsMap.keys().next().value;
        hourlyStatsMap.delete(oldestKey);
      }
    }

    if (mode === 'upgrade') {
      // 先前已記為失敗、此刻成功 → 將失敗轉為成功，總請求數不變
      runtimeCounters.errorRequests = Math.max(0, runtimeCounters.errorRequests - 1);
      runtimeCounters.successRequests += 1;
      entry.error_count = Math.max(0, entry.error_count - 1);
      entry.success_count += 1;
      return;
    }

    runtimeCounters.totalRequests += 1;
    if (isSuccess) {
      runtimeCounters.successRequests += 1;
    } else {
      runtimeCounters.errorRequests += 1;
    }

    entry.request_count += 1;
    if (isSuccess) {
      entry.success_count += 1;
    } else {
      entry.error_count += 1;
    }
  },

  /**
   * 重設運行時計數與小時統計（記憶體歸零）
   */
  reset: () => {
    runtimeCounters.totalRequests = 0;
    runtimeCounters.successRequests = 0;
    runtimeCounters.errorRequests = 0;
    hourlyStatsMap.clear();
    requestOutcomeMap.clear();
  }
};

module.exports = stats;
