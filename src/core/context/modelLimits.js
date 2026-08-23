/**
 * Centralized Model Limits and Context Windows
 */
export const AUTO_COMPRESSION_THRESHOLD = 6000; // Trigger auto compression when context > 6000 tokens

export const MODEL_CONTEXT_LIMITS = {
  // NVIDIA NIM & Open Source LLMs
  'nvidia/llama-3.1-nemotron-120b-instruct': 131072, // 128K
  'nvidia/llama-3.1-nemotron-70b-instruct': 131072,  // 128K
  'nvidia/nemotron-4-340b-instruct': 4096,
  'meta/llama-3.3-70b-instruct': 131072,
  'meta/llama-3.1-405b-instruct': 131072,
  'meta/llama-3.1-70b-instruct': 131072,
  'meta/llama-3.1-8b-instruct': 131072,
  'meta/llama3-70b-instruct': 8192,
  'meta/llama3-8b-instruct': 8192,
  'deepseek-ai/deepseek-r1': 65536,
  'deepseek-ai/deepseek-v3': 65536,
  'qwen/qwen2.5-72b-instruct': 32768,
  'mistralai/mistral-large-2-instruct': 131072,
  'mistralai/mixtral-8x22b-instruct-v0.1': 65536,
  'google/gemma-2-27b-it': 8192,
  
  // OpenAI & Common Models
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-3.5-turbo': 16384,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus-20240229': 200000
};

export const DEFAULT_FALLBACK_CONTEXT_LIMIT = 32768; // 32K default fallback

export function getModelContextLimit(modelId) {
  if (!modelId) return DEFAULT_FALLBACK_CONTEXT_LIMIT;
  if (MODEL_CONTEXT_LIMITS[modelId]) {
    return MODEL_CONTEXT_LIMITS[modelId];
  }
  const lower = modelId.toLowerCase();
  if (lower.includes('128k') || lower.includes('llama-3.1') || lower.includes('llama-3.3') || lower.includes('nemotron')) {
    return 131072;
  }
  if (lower.includes('64k') || lower.includes('deepseek') || lower.includes('mixtral')) {
    return 65536;
  }
  if (lower.includes('32k') || lower.includes('qwen2.5') || lower.includes('qwen-2.5')) {
    return 32768;
  }
  if (lower.includes('16k') || lower.includes('gpt-3.5')) {
    return 16384;
  }
  if (lower.includes('8k') || lower.includes('gemma') || lower.includes('llama3-')) {
    return 8192;
  }
  return DEFAULT_FALLBACK_CONTEXT_LIMIT;
}

export function formatTokenNumber(num) {
  if (!num || num <= 0) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}
