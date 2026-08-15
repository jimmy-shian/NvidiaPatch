/**
 * 上游錯誤內容偵測器（Upstream Error Detector）
 *
 * 專門用於識別上游（如 NVIDIA NIM / OpenAI 相容節點）回傳 HTTP 200，
 * 但實質內容為伺服器錯誤、節點崩潰或降級的假成功回應。
 */

function isUpstreamErrorContent(content) {
  if (!content) return false;

  let text = '';
  if (typeof content === 'string') {
    text = content.trim();
  } else if (typeof content === 'object') {
    try {
      text = JSON.stringify(content);
    } catch {
      return false;
    }
  } else {
    return false;
  }

  if (text.length === 0) return false;

  // 上游錯誤訊息通常很簡短，大於 800 字元的一般對話文字直接跳過
  if (text.length > 800) return false;

  const lower = text.toLowerCase();

  // 1. 常見文字型錯誤
  if (
    lower === 'internal server error' ||
    lower === '"internal server error"' ||
    lower === 'bad gateway' ||
    lower === 'service unavailable' ||
    lower === 'gateway timeout' ||
    lower === 'model is degraded' ||
    lower === 'rate limit exceeded'
  ) {
    return true;
  }

  // 2. HTTP 狀態碼前綴文字（如 "502 Bad Gateway" 或 "500 Internal Server Error"）
  if (/^\s*5\d{2}\s+(internal server error|bad gateway|service unavailable|gateway timeout)\s*$/i.test(lower)) {
    return true;
  }

  // 3. JSON 格式錯誤
  if (lower.startsWith('{') || lower.startsWith('[') || lower.includes('"error"')) {
    try {
      const parsed = typeof content === 'object' ? content : JSON.parse(text);
      if (parsed) {
        // 直接包含 error 欄位
        if (parsed.error) return true;
        // 包含 message 且內容為 server error
        const msg = String(parsed.message || parsed?.data?.message || '').toLowerCase();
        if (
          msg.includes('internal server error') ||
          msg.includes('bad gateway') ||
          msg.includes('service unavailable') ||
          msg.includes('gateway timeout')
        ) {
          return true;
        }
      }
    } catch {
      // JSON 解析失敗但包含明確錯誤模式
      if (
        /internal\s+server\s+error/i.test(lower) ||
        /bad\s+gateway/i.test(lower) ||
        /service\s+unavailable/i.test(lower) ||
        /gateway\s+timeout/i.test(lower)
      ) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  isUpstreamErrorContent
};
