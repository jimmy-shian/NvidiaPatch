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
    'user'
  ];

  const sanitized = {};
  for (const key of standardRootKeys) {
    if (body[key] !== undefined) {
      sanitized[key] = body[key];
    }
  }

  if (sanitized.messages && Array.isArray(sanitized.messages)) {
    // 1. 先過濾掉假串流字元 \uE000（客戶端若把 fake chunk 存入對話歷史傳回來，先在此清掉）
    // 2. 再注入預設 skills 到 system message
    sanitized.messages = injectDefaultSkills(
      sanitized.messages.map((msg) => {
        if (msg && typeof msg === 'object') {
          const cleaned = { ...msg };
          if (typeof cleaned.content === 'string' && /\uE000/.test(cleaned.content)) {
            cleaned.content = stripFakeStreamChars(cleaned.content);
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
        const standardMsgKeys = ['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call', 'refusal', 'reasoning_content'];
        for (const key of standardMsgKeys) {
          if (msg[key] !== undefined) {
            cleanMsg[key] = msg[key];
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
