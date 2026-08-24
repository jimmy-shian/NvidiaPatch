/**
 * Token Manager
 * Handles API Usage Normalization, Multilingual Heuristic Estimation,
 * Preflight Context Projection, and Empty State Safety.
 */

// Heuristic Token Counter supporting multilingual text (CJK, Latin, Code, JSON)
export function estimateTextTokens(text) {
  if (!text || typeof text !== 'string' || text.length === 0) return 0;

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

  const cjkTokens = Math.ceil(cjkCount * 0.85);
  const nonCjkTokens = Math.ceil(nonCjkLength / 3.8);

  return cjkTokens + nonCjkTokens;
}

export function estimateMessageTokens(msg) {
  if (!msg) return 0;
  // Per-message wrapper overhead ~3 tokens
  const overhead = 3;
  const contentTokens = estimateTextTokens(msg.content || '');
  const thinkingTokens = msg.thinkingContent ? estimateTextTokens(msg.thinkingContent) : 0;
  const toolTokens = msg.tool_calls ? estimateTextTokens(JSON.stringify(msg.tool_calls)) : 0;
  return overhead + contentTokens + thinkingTokens + toolTokens;
}

/**
 * Standardize API usage payload from different providers
 */
export function normalizeApiUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== 'object') return null;

  const promptTokens = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? rawUsage.prompt_token_count ?? 0);
  const completionTokens = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? rawUsage.generation_token_count ?? 0);
  const totalTokens = Number(rawUsage.total_tokens ?? (promptTokens + completionTokens));

  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens > 0 ? totalTokens : (promptTokens + completionTokens)
  };
}

/**
 * Calculate full context tokens for live UI & preflight projection
 * Empty chat with no messages and no input strictly returns 0 tokens.
 */
export function estimateFullContextTokens({
  systemPrompt = '',
  summary = '',
  messages = [],
  currentInput = ''
}) {
  if (messages.length === 0 && !currentInput.trim()) {
    return {
      totalTokens: 0,
      systemTokens: 0,
      summaryTokens: 0,
      historyTokens: 0,
      inputTokens: 0
    };
  }

  let systemTokens = systemPrompt ? estimateTextTokens(systemPrompt) + 4 : 0;
  let summaryTokens = summary ? estimateTextTokens(summary) + 4 : 0;
  let historyTokens = 0;

  for (const m of messages) {
    historyTokens += estimateMessageTokens(m);
  }

  let inputTokens = currentInput.trim() ? estimateTextTokens(currentInput) + 4 : 0;
  const totalTokens = systemTokens + summaryTokens + historyTokens + inputTokens;

  return {
    totalTokens,
    systemTokens,
    summaryTokens,
    historyTokens,
    inputTokens
  };
}

/**
 * Preflight context projection before sending next turn to LLM
 * Combines authoritative API usage baseline from last turn with newly added prompt tokens.
 */
export function projectNextTurnContext({
  lastAuthoritativeUsage = null,
  newMessagesSinceLastTurn = [],
  currentInput = '',
  systemPrompt = ''
}) {
  let baseTokens = 0;
  if (lastAuthoritativeUsage && lastAuthoritativeUsage.totalTokens > 0) {
    baseTokens = lastAuthoritativeUsage.totalTokens;
  }

  let additionalTokens = 0;
  for (const m of newMessagesSinceLastTurn) {
    additionalTokens += estimateMessageTokens(m);
  }

  if (currentInput.trim()) {
    additionalTokens += estimateTextTokens(currentInput) + 4;
  }

  if (baseTokens === 0) {
    // Fallback: estimate from full scratch
    return estimateFullContextTokens({
      systemPrompt,
      messages: newMessagesSinceLastTurn,
      currentInput
    }).totalTokens;
  }

  return baseTokens + additionalTokens;
}
