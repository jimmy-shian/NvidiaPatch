/**
 * 假串流機制（Fake / Heartbeat Stream）
 *
 * 在長時間等待模型回應時，前端可能因為長時間無資料而自行斷線。
 * 為避免這個問題，每 10 秒推送一個僅含特殊字元 \uE000 的 chunk 作為心跳訊號，
 * 直到真正的串流回應開始寫入為止（參考請求 #253）。
 *
 * 為何仍使用 data: chunk 而不是 SSE 註解：
 *  - 部分前端（含 Cline / Roo Code / Cursor 等 OpenAI 相容客戶端）只會把
 *    `data: { ... }` 視為模型輸出的 chunk，才會有 keep-alive 效果；
 *    SSE 註解行在某些客戶端不會刷新 timeout。
 *  - 使用私有 Unicode 字元 \uE000（會出現在 content/delta.content 中）做為心跳內容，
 *    這個字元在一般對話中幾乎不會出現，方便後續在Gateway與前端做過濾識別。
 *  - 客戶端收到含 \uE000 的 chunk 後，若把這段 assistant content 送回來，
 *    Gateway 會在 sanitize 階段自動過濾，避免汙染上下文。
 */

const FAKE_CHAR = '\uE000';
// 縮短心跳間隔至 5 秒，避免部分前端（如 Kilo）的 timeout 小於 10 秒時被強制中斷。
const FAKE_INTERVAL_MS = 5000;

function createFakeStreamController({ res, originalBody, requestId, isClientGone }) {
  let charIndex = 0;
  let timer = null;
  let active = false;

  function sendFakeStreamChar() {
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
    } catch (e) {
      active = false;
    }
  }

  function start() {
    active = true;
    timer = setInterval(() => sendFakeStreamChar(), FAKE_INTERVAL_MS);
    sendFakeStreamChar();
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