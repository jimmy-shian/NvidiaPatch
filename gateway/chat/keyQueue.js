/**
 * 金鑰排隊（Key Concurrency Queue）
 *
 * 透過 `global.keyNextRequestTimes` Map 跨 Session 共享每把金鑰
 * 「下一次可發送」的時間，避免同一把金鑰被高併發請求同時打滿。
 *
 * - KEY_CONCURRENCY_DELAY_MS：金鑰送出後需等待的最小間隔
 * - REQUEST_TIMEOUT_MS（×1）：最大允許等待時間；超過則清空記憶體
 */

function ensureKeyQueue() {
  if (!global.keyNextRequestTimes) {
    global.keyNextRequestTimes = new Map();
  }
  return global.keyNextRequestTimes;
}

/**
 * 計算此金鑰目前可發送的時間點。
 * 若 `now < nextAllowedTime`，代表需要排隊等待 `waitMs` 毫秒。
 * 若排隊時間超過上限，會自動清空該金鑰記憶體並允許立即送出。
 *
 * @returns {{ waitMs: number, scheduledTime: number }}
 */
function reserveSlot(keyId, activeConfig) {
  const queue = ensureKeyQueue();
  const concurrencyDelayMs = Number.isFinite(Number(activeConfig?.KEY_CONCURRENCY_DELAY_MS)) 
    ? Number(activeConfig.KEY_CONCURRENCY_DELAY_MS) 
    : 5000;
  const maxAllowedWaitMs = Math.max(Number((activeConfig && activeConfig.REQUEST_TIMEOUT_MS) || 60000), 60000);

  const now = Date.now();
  const nextAllowedTime = queue.get(keyId) || 0;
  let waitMs = 0;
  let scheduledTime = now;

  if (now < nextAllowedTime) {
    const diff = nextAllowedTime - now;
    if (diff > maxAllowedWaitMs) {
      queue.delete(keyId);
      scheduledTime = now;
      waitMs = 0;
    } else {
      waitMs = diff;
      scheduledTime = nextAllowedTime;
    }
  }

  queue.set(keyId, scheduledTime + concurrencyDelayMs);
  return { waitMs, scheduledTime };
}

/**
 * 等待指定的毫秒數；若中途 res 關閉（close / finish），提早結束等待。
 */
function waitForSlot(res, waitMs) {
  return new Promise((resolve) => {
    const waitTimer = setTimeout(resolve, waitMs);
    const handleClose = () => {
      clearTimeout(waitTimer);
      resolve();
    };
    res.once('close', handleClose);
    res.once('finish', () => {
      res.off('close', handleClose);
    });
  });
}

/**
 * 依「下一次可送出時間」排序可用金鑰。
 * 若等待時間過長（> maxSortWaitMs），清空記憶體使其可立即發送。
 */
function sortKeysByAvailability(keys, activeConfig) {
  const queue = ensureKeyQueue();
  const sortNow = Date.now();
  const maxSortWaitMs = Math.max(Number((activeConfig && activeConfig.REQUEST_TIMEOUT_MS) || 60000), 60000);

  return keys.slice().sort((a, b) => {
    let timeA = queue.get(a.id) || 0;
    let timeB = queue.get(b.id) || 0;
    if (timeA > 0 && timeA - sortNow > maxSortWaitMs) {
      queue.delete(a.id);
      timeA = 0;
    }
    if (timeB > 0 && timeB - sortNow > maxSortWaitMs) {
      queue.delete(b.id);
      timeB = 0;
    }
    return timeA - timeB;
  });
}

module.exports = {
  ensureKeyQueue,
  reserveSlot,
  waitForSlot,
  sortKeysByAvailability
};