/**
 * 串流保活心跳機制（Keep-Alive Stream Controller）
 *
 * 在長時間等待模型回應時（如 90k+ tokens 需耗時 10 秒以上），部分前端（如 Kilo / Roo Code）
 * 會因長時間未收到 SSE 資料而判定逾時斷線。
 *
 * 機制：
 *  - 不在 0ms 立即發送，避免干擾正常快速回應之用戶端（如 Cline / OpenAI SDK）
 *  - 僅在等待超過 FAKE_INTERVAL_MS（5 秒）且上游尚未返回時，每 5 秒推送標準 SSE 註解 `: keep-alive`
 *  - 不寫入私有字元 \uE000 的假內容 chunk，避免污染客戶端對話歷史與工具呼叫解析
 */

const FAKE_CHAR = '\uE000';
const FAKE_INTERVAL_MS = 5000;

function createFakeStreamController({ res, originalBody, requestId, isClientGone }) {
  let timer = null;
  let active = false;

  function sendHeartbeatChunk() {
    if (!active) return;
    if (isClientGone() || res.writableEnded || res.destroyed) {
      active = false;
      return;
    }
    try {
      res.write(': keep-alive\n\n');
    } catch (e) {
      active = false;
    }
  }

  function start() {
    active = true;
    // 延遲 5 秒後才開始發送心跳，不於 0ms 立即發送
    timer = setInterval(() => sendHeartbeatChunk(), FAKE_INTERVAL_MS);
  }

  function stop() {
    active = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop };
}

module.exports = {
  createFakeStreamController,
  FAKE_CHAR,
  FAKE_INTERVAL_MS
};