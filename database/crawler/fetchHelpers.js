async function fetchTextWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NVIDIA-NIM-Gateway/1.0',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  fetchTextWithTimeout
};
