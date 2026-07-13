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
    sanitized.messages = sanitized.messages.map(msg => {
      if (msg && typeof msg === 'object') {
        const cleanMsg = {};
        const standardMsgKeys = ['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call', 'refusal'];
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
