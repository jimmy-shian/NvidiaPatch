const { getTaiwanHourString } = require('../../utils/date');

// Process-level in-memory storage for volatile runtime request statistics
const MAX_HOURLY_BUCKETS = 48;

const runtimeCounters = {
  totalRequests: 0,
  successRequests: 0,
  errorRequests: 0
};

// Map: hourStr (YYYY-MM-DD HH:00) -> { hour, request_count, success_count, error_count }
const hourlyStatsMap = new Map();

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
   */
  recordRequest: (isSuccess) => {
    runtimeCounters.totalRequests += 1;
    if (isSuccess) {
      runtimeCounters.successRequests += 1;
    } else {
      runtimeCounters.errorRequests += 1;
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
  }
};

module.exports = stats;

