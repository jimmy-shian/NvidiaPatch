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
  'ignore_eos'
];

function hasNonEmptyMessageContent(content) {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  if (Array.isArray(content)) {
    return content.length > 0;
  }
  return false;
}

function toContentParts(content) {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content.slice();
  }
  if (content == null) return [];
  return [{ type: 'text', text: String(content) }];
}

function mergeMessageContents(baseContent, extraContent, separator = '\n\n---\n\n') {
  if (!hasNonEmptyMessageContent(extraContent)) return baseContent;
  if (!hasNonEmptyMessageContent(baseContent)) return extraContent;
  if (typeof baseContent === 'string' && typeof extraContent === 'string') {
    return `${baseContent}${separator}${extraContent}`;
  }
  return [
    ...toContentParts(baseContent),
    { type: 'text', text: separator },
    ...toContentParts(extraContent)
  ];
}

function prependSystemNoticePrefix(content) {
  const prefix = '[System Notice]\n';
  if (typeof content === 'string') {
    if (!content) return '[System Notice]';
    return content.startsWith('[System Notice]') ? content : `${prefix}${content}`;
  }
  if (Array.isArray(content)) {
    return [{ type: 'text', text: prefix }, ...content];
  }
  return content == null ? '[System Notice]' : `${prefix}${String(content)}`;
}

/**
 * 正規化對話訊息結構以相容 NVIDIA NIM vLLM Jinja 模板：
 *  1. 開頭連續 system 合併為單一 system 訊息；非開頭的中段 system 轉為 user（加 [System Notice] 前綴）
 *  2. 清理含 tool_calls 且 content 為空字串的 assistant 訊息（轉為 null）
 *  3. NVIDIA 端點移除歷史 assistant 訊息上的 reasoning_content / reasoning / thought / thinking 與 refusal: null
 *  4. 剔除歷史中既無有效 content 也無 tool_calls / function_call 的空白 assistant 訊息（保留最後一則 prefill）
 */
function normalizeChatMessages(messages, { nvidiaEndpoint = false } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const systemNormalized = [];
  let seenNonSystem = false;

  for (const rawMsg of messages) {
    if (!rawMsg || typeof rawMsg !== 'object') {
      seenNonSystem = true;
      systemNormalized.push(rawMsg);
      continue;
    }

    const msg = { ...rawMsg };
    if (msg.role === 'system') {
      if (!seenNonSystem) {
        if (systemNormalized.length > 0 && systemNormalized[0]?.role === 'system') {
          systemNormalized[0] = {
            ...systemNormalized[0],
            content: mergeMessageContents(systemNormalized[0].content, msg.content)
          };
        } else {
          systemNormalized.push(msg);
        }
      } else {
        systemNormalized.push({
          ...msg,
          role: 'user',
          content: prependSystemNoticePrefix(msg.content)
        });
      }
    } else {
      seenNonSystem = true;
      systemNormalized.push(msg);
    }
  }

  const finalMessages = [];
  for (let i = 0; i < systemNormalized.length; i += 1) {
    const item = systemNormalized[i];
    if (!item || typeof item !== 'object') {
      finalMessages.push(item);
      continue;
    }

    const msg = { ...item };
    if (msg.role === 'assistant') {
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length === 0) {
        delete msg.tool_calls;
      }

      const hasToolCalls = Boolean(
        (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) ||
        msg.function_call
      );

      if (hasToolCalls && msg.content === '') {
        msg.content = null;
      }

      if (nvidiaEndpoint) {
        delete msg.reasoning_content;
        delete msg.reasoning;
        delete msg.thought;
        delete msg.thinking;
        if (msg.refusal === null) {
          delete msg.refusal;
        }
      }

      const isLastMessage = i === systemNormalized.length - 1;
      if (!hasToolCalls && !hasNonEmptyMessageContent(msg.content) && !isLastMessage) {
        continue;
      }
    }

    finalMessages.push(msg);
  }

  return finalMessages;
}

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
    if (sanitized.max_completion_tokens !== undefined) {
      if (sanitized.max_tokens === undefined) {
        sanitized.max_tokens = sanitized.max_completion_tokens;
      }
      delete sanitized.max_completion_tokens;
    }
    if (Array.isArray(sanitized.tools) && sanitized.tools.length === 0) {
      delete sanitized.tools;
      delete sanitized.tool_choice;
      delete sanitized.parallel_tool_calls;
    }
  }

  if (sanitized.messages && Array.isArray(sanitized.messages)) {
    // 1. 過濾假串流字元 \uE000（支援 string 與 multimodal Array 格式），並將 developer 轉為 system
    // 2. 注入預設 skills 到 system message
    // 3. 正規化多筆/中段 system 與歷史 assistant 訊息
    const normalizedInputMessages = sanitized.messages.map((msg) => {
      if (msg && typeof msg === 'object') {
        const cleaned = { ...msg };
        if (cleaned.role === 'developer') {
          cleaned.role = 'system';
        }
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
    });

    const injectedMessages = injectDefaultSkills(normalizedInputMessages).map(msg => {
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

    sanitized.messages = normalizeChatMessages(injectedMessages, {
      nvidiaEndpoint: Boolean(options && options.nvidiaEndpoint)
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
  applyGlmReasoningConversion,
  normalizeChatMessages
};
