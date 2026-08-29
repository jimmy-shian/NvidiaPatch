/**
 * 假串流與心跳機制（Fake / Heartbeat Stream Controller）
 *
 * 在長時間等待模型回應時（如 90k+ tokens 需耗時 10 秒以上），部分前端（如 Kilo / Roo Code）
 * 會因長時間未收到 SSE data chunk 而判定逾時斷線。
 *
 * 機制：
 *  - 不在 0ms 立即發送，避免干擾正常快速回應之用戶端（如 Cline / OpenAI SDK）
 *  - 僅在等待超過 FAKE_INTERVAL_MS（5 秒）且上游尚未返回時，每 5 秒推送包含 \uE000 的假串流 chunk 與 : keep-alive
 *  - 刷新 Kilo 的 data 接收計時器與網路連線活性，防止客戶端中斷
 *  - 下游 sanitize 模組會自動過濾 \uE000，確保歷史上下文不被污染
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
    const chunkData = JSON.stringify({
      id: `chatcmpl-gateway-${requestId}-fake`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: originalBody.model || 'patcher-main',
      choices: [{ index: 0, delta: { content: FAKE_CHAR }, finish_reason: null }]
    });
    try {
      res.write(`data: ${chunkData}\n\n`);
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