/**
 * Token Manager - Estimates token usage for LLM requests
 * Accounts for System Prompts, Personal Context, Skills, Compressed Summaries, and Messages.
 */

// Heuristic Token Counter supporting multilingual text (CJK, Latin, Code, JSON)
export function estimateTextTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  let cjkCount = 0;
  let nonCjkLength = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs, Hiragana, Katakana, Hangul, Zhuyin, Fullwidth forms
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3100 && code <= 0x312f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkCount++;
    } else {
      nonCjkLength++;
    }
  }

  // CJK characters average ~0.7 to 1 token per character in modern subword tokenizers (Llama3/Nemotron/OpenAI)
  const cjkTokens = Math.ceil(cjkCount * 0.85);
  // Latin/Code/English text average ~1 token per 3.8 characters
  const nonCjkTokens = Math.ceil(nonCjkLength / 3.8);

  return Math.max(1, cjkTokens + nonCjkTokens);
}

export function estimateMessageTokens(msg) {
  if (!msg) return 0;
  // Per-message wrapper overhead (role tag, delimiters) ~4 tokens
  const overhead = 4;
  const contentTokens = estimateTextTokens(msg.content || '');
  const thinkingTokens = msg.thinkingContent ? estimateTextTokens(msg.thinkingContent) : 0;
  return overhead + contentTokens + thinkingTokens;
}

export function estimateFullContextTokens({
  systemPrompt = '',
  summary = '',
  messages = [],
  currentInput = ''
}) {
  let systemTokens = systemPrompt ? estimateTextTokens(systemPrompt) + 4 : 0;
  let summaryTokens = summary ? estimateTextTokens(summary) + 6 : 0;
  let historyTokens = 0;

  for (const m of messages) {
    historyTokens += estimateMessageTokens(m);
  }

  let inputTokens = currentInput ? estimateTextTokens(currentInput) + 4 : 0;

  const totalTokens = systemTokens + summaryTokens + historyTokens + inputTokens;

  return {
    totalTokens,
    systemTokens,
    summaryTokens,
    historyTokens,
    inputTokens
  };
}
