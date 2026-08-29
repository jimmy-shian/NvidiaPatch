/**
 * URL 解析與正規化工具函式
 * 支援 NVIDIA 官方 NIM、Ollama、LM Studio、vLLM、LocalAI 等多種上游端點
 */

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return 'https://integrate.api.nvidia.com/v1';
  return baseUrl.trim().replace(/\/+$/, '');
}

function isCustomUpstreamUrl(baseUrl) {
  const clean = normalizeBaseUrl(baseUrl).toLowerCase();
  return !clean.includes('integrate.api.nvidia.com') && !clean.includes('build.nvidia.com');
}

/**
 * 自動解析 /chat/completions 完整端點 URL
 * - 若使用者輸入 http://localhost:11434 (Ollama) 或 http://localhost:1234 (LM Studio)（無 /v1 路徑），自動補上 /v1/chat/completions
 * - 若使用者輸入已含 /v1，補上 /chat/completions
 * - 若使用者輸入已含 /chat/completions，直接使用
 */
function resolveChatCompletionsUrl(baseUrl) {
  const clean = normalizeBaseUrl(baseUrl);
  if (clean.endsWith('/chat/completions')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/chat/completions`;

  try {
    const u = new URL(clean);
    if (!u.pathname || u.pathname === '/' || u.pathname === '') {
      return `${clean}/v1/chat/completions`;
    }
  } catch (_) {}

  return `${clean}/chat/completions`;
}

/**
 * 解析健康檢查或 Key 測試時使用的 /models 端點 URL
 */
function resolveModelsCheckUrl(baseUrl) {
  const clean = normalizeBaseUrl(baseUrl);
  if (clean.endsWith('/models') || clean.endsWith('/tags')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/models`;

  try {
    const u = new URL(clean);
    if (!u.pathname || u.pathname === '/' || u.pathname === '') {
      return `${clean}/v1/models`;
    }
  } catch (_) {}

  return `${clean}/models`;
}

module.exports = {
  normalizeBaseUrl,
  isCustomUpstreamUrl,
  resolveChatCompletionsUrl,
  resolveModelsCheckUrl
};
