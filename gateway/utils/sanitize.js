const { injectDefaultSkills } = require('../skills/injector');
const { stripFakeStreamChars } = require('../chat/utils/fakeStreamFilter');

function sanitizeChatCompletionBody(body) {
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

module.exports = {
  sanitizeChatCompletionBody
};
