const { injectDefaultSkills } = require('../skills/injector');
const { stripFakeStreamChars } = require('../chat/utils/fakeStreamFilter');

/**
 * NVIDIA NIM 已知不支援（會靜默丟棄或回 HTTP 400）的 OpenAI 標準參數清單。
 *
 * 來源：NVIDIA 論壇 Bug Report（含 ignore_eos 在內共 10 個參數）。
 * 官方回覆僅支援 temperature / top_p / max_tokens 等有限集合，
 * 其餘由 vLLM 端靜默忽略，實際行為與 OpenAI 規格不符。
 *
 * 注意：reasoning_effort 不在此處移除，
 * 而是保留給 sendSingleRequest 依目標模型決定轉換或丟棄
 * （GLM 系列轉為 chat_template_kwargs，其餘模型直接移除）。
 *
 * @see https://forums.developer.nvidia.com/t/bug-report-nvidia-nim-hosted-endpoint-reliability-issues-bugs-requiring-extensive-client-side-workarounds/366612
 */
const NVIDIA_UNSUPPORTED_PARAMS = [
  'frequency_penalty',
  'presence_penalty',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'seed',
  'stop',
  'stream_options',
  'ignore_eos'
];

function sanitizeChatCompletionBody(body, options = {}) {
  if (!body || typeof body !== 'object') return body;

  const standardRootKeys = [
    'messages',
    'model',
    'frequency_penalty',
    'logit_bias',
    'logprobs',
    'top_logprobs',
    'max_tokens',
    'max_completion_tokens',
    'n',
    'presence_penalty',
    'response_format',
    'seed',
    'stop',
    'stream',
    'stream_options',
    'temperature',
    'top_p',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'user',
    'reasoning_effort',
    'modalities',
    'audio',
    'service_tier',
    'prediction',
    'dimensions',
    'encoding_format'
  ];

  const sanitized = {};
  for (const key of standardRootKeys) {
    if (body[key] !== undefined) {
      sanitized[key] = body[key];
    }
  }

  // Preserve any other custom top-level fields (e.g., vendor-specific extension options)
  for (const [key, value] of Object.entries(body)) {
    if (sanitized[key] === undefined && !key.startsWith('_') && value !== undefined) {
      sanitized[key] = value;
    }
  }

  // NVIDIA NIM 端點：移除不支援的參數，避免被靜默丟棄或觸發 HTTP 400。
  // 自訂端點（Ollama / LM Studio / vLLM / LocalAI）不過濾，維持完整 OpenAI 規格透傳。
  if (options && options.nvidiaEndpoint) {
    for (const key of NVIDIA_UNSUPPORTED_PARAMS) {
      if (sanitized[key] !== undefined) {
        delete sanitized[key];
      }
    }
  }

  if (sanitized.messages && Array.isArray(sanitized.messages)) {
    // 1. 過濾假串流字元 \uE000（支援 string 與 multimodal Array 格式）
    // 2. 注入預設 skills 到 system message
    sanitized.messages = injectDefaultSkills(
      sanitized.messages.map((msg) => {
        if (msg && typeof msg === 'object') {
          const cleaned = { ...msg };
          if (typeof cleaned.content === 'string' && /\uE000/.test(cleaned.content)) {
            cleaned.content = stripFakeStreamChars(cleaned.content);
          } else if (Array.isArray(cleaned.content)) {
            // Multimodal content array (e.g. OpenAI / NVIDIA Vision format: [{ type: "text", text: "..." }, { type: "image_url", image_url: { url: "..." } }])
            cleaned.content = cleaned.content.map(part => {
              if (part && typeof part === 'object') {
                const cleanPart = { ...part };
                if (typeof cleanPart.text === 'string' && /\uE000/.test(cleanPart.text)) {
                  cleanPart.text = stripFakeStreamChars(cleanPart.text);
                }
                return cleanPart;
              }
              return part;
            });
          }
          if (typeof cleaned.reasoning_content === 'string' && /\uE000/.test(cleaned.reasoning_content)) {
            cleaned.reasoning_content = stripFakeStreamChars(cleaned.reasoning_content);
          }
          return cleaned;
        }
        return msg;
      })
    ).map(msg => {
      if (msg && typeof msg === 'object') {
        const cleanMsg = {};
        const standardMsgKeys = ['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call', 'refusal', 'reasoning_content', 'audio'];
        for (const key of standardMsgKeys) {
          if (msg[key] !== undefined) {
            cleanMsg[key] = msg[key];
          }
        }
        // Preserve any custom non-standard keys in message
        for (const [key, value] of Object.entries(msg)) {
          if (cleanMsg[key] === undefined && !key.startsWith('_') && value !== undefined) {
            cleanMsg[key] = value;
          }
        }
        return cleanMsg;
      }
      return msg;
    });
  }

  return sanitized;
}

/**
 * 判定模型是否屬於 GLM 系列（z-ai/glm-*、thudm/glm-* 等）。
 *
 * @param {unknown} modelId
 * @returns {boolean}
 */
function isGlmFamilyModel(modelId) {
  return typeof modelId === 'string' && modelId.toLowerCase().includes('glm');
}

/**
 * GLM 系列 reasoning 參數轉換（NVIDIA NIM Bug 4 修正）。
 *
 * NIM 的 vLLM 後端不認識 OpenAI 標準 reasoning_effort 參數，
 * GLM 系列改由 chat_template_kwargs.enable_thinking / clear_thinking 控制思考鏈開關。
 *
 * 對映規則：
 *  - reasoning_effort: 'none' / 'minimal' / 'disabled' / 'off' → enable_thinking: false
 *  - 其他（'low' / 'medium' / 'high' / 'max'）                    → enable_thinking: true
 *
 * 非 GLM 模型：直接移除不支援的 reasoning_effort（避免靜默丟棄）。
 * 注意：呼叫端須確認目標端點為 NVIDIA NIM 才呼叫本函式（自訂端點不過濾/轉換）。
 *
 * @param {object} body     - 已整理好的 request body（就地修改）
 * @param {string} modelId  - 實際上欲轉發的 upstream 模型 ID
 * @returns {object} body
 */
function applyGlmReasoningConversion(body, modelId) {
  if (!body || typeof body !== 'object') return body;

  if (!isGlmFamilyModel(modelId)) {
    if (body.reasoning_effort !== undefined) {
      delete body.reasoning_effort;
    }
    return body;
  }

  if (body.reasoning_effort === undefined) return body;

  const effort = String(body.reasoning_effort).toLowerCase();
  const enableThinking = !(effort === 'none' || effort === 'minimal' || effort === 'disabled' || effort === 'off');
  delete body.reasoning_effort;

  const existing = (body.chat_template_kwargs && typeof body.chat_template_kwargs === 'object' && !Array.isArray(body.chat_template_kwargs))
    ? body.chat_template_kwargs
    : {};
  body.chat_template_kwargs = { ...existing, enable_thinking: enableThinking, clear_thinking: false };
  return body;
}

module.exports = {
  sanitizeChatCompletionBody,
  applyGlmReasoningConversion
};
