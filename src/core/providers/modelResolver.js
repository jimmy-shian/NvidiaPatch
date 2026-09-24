/**
 * Upstream Model ID 解析與符號容錯對齊模組
 *
 * 解決 NVIDIA 網頁前端 URL Slug（連字號 - ）與官方標準 API Model ID（小數點 . ）不一致的問題
 * 例如：z-ai/glm-5-3-flash ➔ z-ai/glm-5.3-flash，避免 upstream 回傳 404
 * 注意：僅在發送請求前作替換，不更動模型爬蟲或選單抓取的原始資料。
 */

export const KNOWN_MODEL_ALIASES = {
  'z-ai/glm-5-3': 'z-ai/glm-5.3',
  'z-ai/glm-5-3-flash': 'z-ai/glm-5.3-flash',
  'z-ai/glm-53': 'z-ai/glm-5.3',
  'z-ai/glm-53-flash': 'z-ai/glm-5.3-flash',
  'moonshotai/kimi-k2-6': 'moonshotai/kimi-k2.6',
  'microsoft/phi-3-5-moe-instruct': 'microsoft/phi-3.5-moe-instruct',
  'nvidia/nemotron-3-5-lightning-30b-a3b': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-5-content-safety': 'nvidia/nemotron-3.5-content-safety',
  'nvidia/llama-3-1-nemotron-51b-instruct': 'nvidia/llama-3.1-nemotron-51b-instruct',
  'nvidia/llama-3-1-nemotron-70b-instruct': 'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/llama-3-1-nemotron-ultra-253b-v1': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'nvidia/ising-calibration-1-5-31b': 'nvidia/ising-calibration-1.5-31b',
  'ibm/granite-3-0-8b-instruct': 'ibm/granite-3.0-8b-instruct',
  'ibm/granite-3-0-3b-a800m-instruct': 'ibm/granite-3.0-3b-a800m-instruct',
  'poolside/laguna-xs-2-1': 'poolside/laguna-xs-2.1',
  'google/codegemma-1-1-7b': 'google/codegemma-1.1-7b'
};

export const OFFICIAL_MODELS = [
  "01-ai/yi-large",
  "adept/fuyu-8b",
  "ai21labs/jamba-1.5-large-instruct",
  "aisingapore/sea-lion-7b-instruct",
  "bigcode/starcoder2-15b",
  "databricks/dbrx-instruct",
  "deepseek-ai/deepseek-coder-6.7b-instruct",
  "deepseek-ai/deepseek-v4.1-flash",
  "google/codegemma-1.1-7b",
  "google/codegemma-7b",
  "google/deplot",
  "google/diffusiongemma-26b-a4b-it",
  "google/gemma-2b",
  "google/gemma-3-12b-it",
  "google/gemma-3-4b-it",
  "google/gemma-4-31b-it",
  "google/recurrentgemma-2b",
  "ibm/granite-3.0-3b-a800m-instruct",
  "ibm/granite-3.0-8b-instruct",
  "ibm/granite-34b-code-instruct",
  "ibm/granite-8b-code-instruct",
  "meta/codellama-70b",
  "meta/llama-3.2-11b-vision-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "meta/llama-guard-4-12b",
  "meta/llama2-70b",
  "meta/muse-glimmer-30b",
  "microsoft/kosmos-2",
  "microsoft/phi-3-vision-128k-instruct",
  "microsoft/phi-3.5-moe-instruct",
  "mistralai/codestral-22b-instruct-v0.1",
  "mistralai/mistral-7b-instruct-v0.3",
  "mistralai/mistral-large",
  "mistralai/mistral-large-2-instruct",
  "mistralai/mistral-nemotron",
  "mistralai/mixtral-8x22b-v0.1",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k3",
  "nv-mistralai/mistral-nemo-12b-instruct",
  "nvidia/ai-synthetic-video-detector",
  "nvidia/cosmos-reason2-8b",
  "nvidia/embed-qa-4",
  "nvidia/ising-calibration-1.5-31b",
  "nvidia/llama-3.1-nemoguard-8b-content-safety",
  "nvidia/llama-3.1-nemoguard-8b-topic-control",
  "nvidia/llama-3.1-nemotron-51b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
  "nvidia/llama-3.2-nv-embedqa-1b-v1",
  "nvidia/llama-nemotron-embed-vl-1b-v2",
  "nvidia/llama3-chatqa-1.5-70b",
  "nvidia/mistral-nemo-minitron-8b-8k-instruct",
  "nvidia/nemotron-3-embed-1b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3.5-content-safety",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-4-340b-instruct",
  "nvidia/nemotron-4-340b-reward",
  "nvidia/nemotron-nano-3-30b-a3b",
  "nvidia/nemotron-parse",
  "nvidia/nemotron-parse-2.0",
  "nvidia/neva-22b",
  "nvidia/nv-embedqa-mistral-7b-v2",
  "nvidia/nvclip",
  "nvidia/riva-translate-4b-instruct",
  "nvidia/riva-translate-4b-instruct-v1.1",
  "nvidia/riva-translate-4b-instruct-v2",
  "nvidia/vila",
  "openai/gpt-oss-20b",
  "poolside/laguna-xs-2.1",
  "snowflake/arctic-embed-l",
  "writer/palmyra-creative-122b",
  "writer/palmyra-fin-70b-32k",
  "writer/palmyra-med-70b",
  "writer/palmyra-med-70b-32k",
  "z-ai/glm-5.3",
  "z-ai/glm-5.3-flash",
  "zyphra/zamba2-7b-instruct"
];

const OFFICIAL_MODELS_SET = new Set(OFFICIAL_MODELS);

/**
 * 移除特殊符號（-、.、_）並轉小寫，用於容錯對齊比對
 */
export function normalizeSymbolKey(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().replace(/[-_.]/g, '');
}

/**
 * 智慧解析上游標準 Model ID（於發送請求前呼叫）
 *
 * @param {string} rawModelId 使用者配置或請求傳入的模型 ID
 * @param {Array<string>} [extraCandidates=[]] 額外可用模型候選清單（可選）
 * @returns {string} 校正後的標準 Model ID
 */
export function resolveUpstreamModelId(rawModelId, extraCandidates = []) {
  if (!rawModelId || typeof rawModelId !== 'string') return rawModelId;
  const trimmed = rawModelId.trim();
  if (!trimmed) return trimmed;

  // 1. 若本身已精確符合官方已知模型，直接回傳
  if (OFFICIAL_MODELS_SET.has(trimmed)) {
    return trimmed;
  }

  // 2. 檢查明確映射表（已知別名）
  if (KNOWN_MODEL_ALIASES[trimmed]) {
    return KNOWN_MODEL_ALIASES[trimmed];
  }

  // 3. 通用符號歸一化比對（忽略 . 與 - 差異）
  const allCandidates = [...OFFICIAL_MODELS, ...extraCandidates];
  const targetNorm = normalizeSymbolKey(trimmed);

  const slashIdx = trimmed.indexOf('/');
  const targetProvider = slashIdx !== -1 ? trimmed.slice(0, slashIdx).toLowerCase() : null;
  const targetSlugNorm = slashIdx !== -1 ? normalizeSymbolKey(trimmed.slice(slashIdx + 1)) : targetNorm;

  const matched = allCandidates.filter((cand) => {
    if (!cand || typeof cand !== 'string') return false;
    const candSlash = cand.indexOf('/');
    if (targetProvider && candSlash !== -1) {
      const candProvider = cand.slice(0, candSlash).toLowerCase();
      if (candProvider !== targetProvider) return false;
      return normalizeSymbolKey(cand.slice(candSlash + 1)) === targetSlugNorm;
    }
    return normalizeSymbolKey(cand) === targetNorm;
  });

  const uniqueMatched = [...new Set(matched)];
  if (uniqueMatched.length === 1) {
    return uniqueMatched[0];
  }

  return trimmed;
}
