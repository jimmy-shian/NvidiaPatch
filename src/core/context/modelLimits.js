/**
 * Centralized Model Limits, Context Windows & Dynamic Compression Thresholds
 * 
 * Hierarchy:
 * 1. Explicit verified overrides
 * 2. Family heuristics (Nemotron, Llama, DeepSeek, GPT, Claude, Gemini, Qwen, Mistral)
 * 3. Conservative fallback
 */

export const MODEL_CONTEXT_LIMITS = {
  // NVIDIA NIM & Open Source Reasoning LLMs
  'nvidia/llama-3.1-nemotron-120b-instruct': 131072, // 128K
  'nvidia/llama-3.1-nemotron-70b-instruct': 131072,  // 128K
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 131072, // 128K
  'nvidia/nemotron-3-ultra-550b-a55b': 131072,       // 128K
  'nvidia/nemotron-3-super-120b-a12b': 131072,       // 128K
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 65536, // 64K
  'nvidia/nemotron-4-340b-instruct': 4096,
  'openai/gpt-oss-120b': 131072,                     // 128K
  'openai/gpt-oss-20b': 131072,                      // 128K
  'deepseek-ai/deepseek-v4-flash-0731': 65536,       // 64K
  'deepseek-ai/deepseek-r1': 65536,                  // 64K
  'deepseek-ai/deepseek-v3': 65536,                  // 64K
  'minimaxai/minimax-m3': 131072,                    // 128K
  'stepfun-ai/step-3.7-flash': 65536,                // 64K
  'meta/llama-3.3-70b-instruct': 131072,             // 128K
  'meta/llama-3.1-405b-instruct': 131072,            // 128K
  'meta/llama-3.1-70b-instruct': 131072,             // 128K
  'meta/llama-3.1-8b-instruct': 131072,              // 128K
  'meta/llama3-70b-instruct': 8192,
  'meta/llama3-8b-instruct': 8192,
  'qwen/qwen2.5-72b-instruct': 32768,
  'mistralai/mistral-large-2-instruct': 131072,
  'mistralai/mixtral-8x22b-instruct-v0.1': 65536,
  'google/gemma-2-27b-it': 8192,
  'google/gemma-3-12b-it': 32768,
  
  // OpenAI & Common Models
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-3.5-turbo': 16384,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus-20240229': 200000
};

export const DEFAULT_FALLBACK_CONTEXT_LIMIT = 32768; // 32K conservative fallback

/**
 * Get context limit info with provenance
 */
export function getModelContextInfo(modelId) {
  if (!modelId) {
    return { limit: DEFAULT_FALLBACK_CONTEXT_LIMIT, provenance: 'fallback' };
  }
  if (MODEL_CONTEXT_LIMITS[modelId]) {
    return { limit: MODEL_CONTEXT_LIMITS[modelId], provenance: 'known' };
  }
  const lower = modelId.toLowerCase();
  if (lower.includes('200k')) return { limit: 204800, provenance: 'estimated' };
  if (lower.includes('128k') || lower.includes('llama-3.1') || lower.includes('llama-3.3') || lower.includes('nemotron') || lower.includes('minimax')) {
    return { limit: 131072, provenance: 'estimated' };
  }
  if (lower.includes('64k') || lower.includes('deepseek') || lower.includes('mixtral') || lower.includes('step')) {
    return { limit: 65536, provenance: 'estimated' };
  }
  if (lower.includes('32k') || lower.includes('qwen2.5') || lower.includes('qwen-2.5') || lower.includes('qwen')) {
    return { limit: 32768, provenance: 'estimated' };
  }
  if (lower.includes('16k') || lower.includes('gpt-3.5')) {
    return { limit: 16384, provenance: 'estimated' };
  }
  if (lower.includes('8k') || lower.includes('gemma') || lower.includes('llama3-')) {
    return { limit: 8192, provenance: 'estimated' };
  }
  return { limit: DEFAULT_FALLBACK_CONTEXT_LIMIT, provenance: 'fallback' };
}

export function getModelContextLimit(modelId) {
  return getModelContextInfo(modelId).limit;
}

/**
 * Dynamic 80% Context Compression Threshold calculation
 * Reserves output budget (e.g. 2048 - 4096 tokens) so next generation has ample space.
 * @param {string} modelId
 * @param {number} outputBudget
 * @returns {number} Threshold in tokens
 */
export function getCompressionThreshold(modelId, outputBudget = 4096) {
  const limit = getModelContextLimit(modelId);
  const eightyPercent = Math.floor(limit * 0.8);
  // Ensure we also leave at least outputBudget tokens
  const budgetThreshold = Math.max(0, limit - outputBudget);
  return Math.min(eightyPercent, budgetThreshold);
}

export function formatTokenNumber(num) {
  if (!num || num <= 0) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}
