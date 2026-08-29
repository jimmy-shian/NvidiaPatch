/**
 * 上游錯誤內容偵測器（Upstream Error Detector）
 *
 * 專門用於識別上游（如 NVIDIA NIM / OpenAI 相容節點）回傳 HTTP 200，
 * 但實質內容為伺服器錯誤、節點崩潰或降級的假成功回應。
 */

function extractUpstreamErrorDetail(content) {
  if (!content) return '';

  if (typeof content === 'object') {
    if (content.error) {
      if (typeof content.error === 'string') return content.error;
      if (typeof content.error === 'object') {
        return content.error.message || content.error.detail || JSON.stringify(content.error);
      }
    }
    if (content.message) return String(content.message);
    if (content.detail) return String(content.detail);
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }

  const text = String(content || '').trim();
  if (!text) return '';

  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) {
        if (typeof parsed.error === 'string') return parsed.error;
        if (typeof parsed.error === 'object') {
          return parsed.error.message || parsed.error.detail || JSON.stringify(parsed.error);
        }
      }
      if (parsed.message) return String(parsed.message);
      if (parsed.detail) return String(parsed.detail);
    } catch {
      // not valid JSON, fallback to text
    }
  }

  return text.length > 200 ? text.slice(0, 200) + '...' : text;
}

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

  // 上游錯誤訊息通常很簡短，大於 1200 字元的一般對話文字直接跳過
  if (text.length > 1200) return false;

  const lower = text.toLowerCase();

  // 1. 常見文字型錯誤
  if (
    lower === 'internal server error' ||
    lower === '"internal server error"' ||
    lower === 'bad gateway' ||
    lower === 'service unavailable' ||
    lower === 'gateway timeout' ||
    lower === 'model is degraded' ||
    lower === 'model is overloaded' ||
    lower === 'service temporarily overloaded' ||
    lower === 'rate limit exceeded'
  ) {
    return true;
  }

  // 2. HTTP 狀態碼前綴文字（如 "502 Bad Gateway" 或 "500 Internal Server Error"）
  if (/^\s*5\d{2}\s+(internal server error|bad gateway|service unavailable|gateway timeout|service temporarily overloaded)\s*$/i.test(lower)) {
    return true;
  }

  // 3. 關鍵錯誤片語
  if (
    lower.includes('service temporarily overloaded') ||
    lower.includes('upstream connect error') ||
    lower.includes('upstream connection error') ||
    lower.includes('model is overloaded') ||
    lower.includes('temporarily overloaded') ||
    lower.includes('backend connection failure')
  ) {
    return true;
  }

  // 4. JSON 格式錯誤
  if (lower.startsWith('{') || lower.startsWith('[') || lower.includes('"error"')) {
    try {
      const parsed = typeof content === 'object' ? content : JSON.parse(text);
      if (parsed) {
        // 直接包含 error 欄位
        if (parsed.error) return true;
        // 包含 message 且內容為 server error
        const msg = String(parsed.message || parsed?.data?.message || parsed?.detail || '').toLowerCase();
        if (
          msg.includes('internal server error') ||
          msg.includes('bad gateway') ||
          msg.includes('service unavailable') ||
          msg.includes('gateway timeout') ||
          msg.includes('temporarily overloaded') ||
          msg.includes('model is degraded') ||
          msg.includes('rate limit exceeded')
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
        /gateway\s+timeout/i.test(lower) ||
        /temporarily\s+overloaded/i.test(lower)
      ) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  isUpstreamErrorContent,
  extractUpstreamErrorDetail
};

