import { describe, it, expect } from 'vitest';
import {
  estimateTextTokens,
  estimateFullContextTokens,
  normalizeApiUsage,
  projectNextTurnContext
} from '../context/tokenManager';
import {
  getModelContextLimit,
  getCompressionThreshold,
  getModelContextInfo,
  formatTokenNumber
} from '../context/modelLimits';

describe('Token Manager & Context Limits', () => {
  it('returns strictly 0 tokens for empty text and empty conversation', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens(null)).toBe(0);

    const emptyContext = estimateFullContextTokens({
      systemPrompt: '',
      summary: '',
      messages: [],
      currentInput: ''
    });

    expect(emptyContext.totalTokens).toBe(0);
    expect(emptyContext.historyTokens).toBe(0);
  });

  it('correctly normalizes API usage from different vendor structures', () => {
    const openaiUsage = normalizeApiUsage({
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165
    });
    expect(openaiUsage).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165
    });

    const alternateUsage = normalizeApiUsage({
      input_tokens: 80,
      output_tokens: 30
    });
    expect(alternateUsage).toEqual({
      promptTokens: 80,
      completionTokens: 30,
      totalTokens: 110
    });
  });

  it('projects next turn context by combining authoritative usage baseline with new input', () => {
    const projected = projectNextTurnContext({
      lastAuthoritativeUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      newMessagesSinceLastTurn: [],
      currentInput: 'Hello world, how are you today?',
      systemPrompt: 'System'
    });

    expect(projected).toBeGreaterThan(150);
  });

  it('calculates dynamic 80% compression threshold and reserves output budget', () => {
    // 128K model
    const limit128k = getModelContextLimit('nvidia/llama-3.1-nemotron-120b-instruct');
    expect(limit128k).toBe(131072);
    const threshold128k = getCompressionThreshold('nvidia/llama-3.1-nemotron-120b-instruct', 4096);
    expect(threshold128k).toBe(Math.floor(131072 * 0.8)); // 104857 tokens

    // 64K model
    const limit64k = getModelContextLimit('deepseek-ai/deepseek-v4-flash-0731');
    expect(limit64k).toBe(65536);
    const threshold64k = getCompressionThreshold('deepseek-ai/deepseek-v4-flash-0731', 4096);
    expect(threshold64k).toBe(Math.floor(65536 * 0.8)); // 52428 tokens
  });

  it('tracks context window provenance hierarchy', () => {
    const known = getModelContextInfo('nvidia/llama-3.1-nemotron-120b-instruct');
    expect(known.provenance).toBe('known');

    const estimated = getModelContextInfo('custom-org/some-unknown-llama-3.3-model');
    expect(estimated.provenance).toBe('estimated');
    expect(estimated.limit).toBe(131072);

    const fallback = getModelContextInfo('random-unknown-model-xyz');
    expect(fallback.provenance).toBe('fallback');
    expect(fallback.limit).toBe(32768);
  });

  it('formats token numbers nicely', () => {
    expect(formatTokenNumber(0)).toBe('0');
    expect(formatTokenNumber(500)).toBe('500');
    expect(formatTokenNumber(1200)).toBe('1.2K');
    expect(formatTokenNumber(131072)).toBe('131.1K');
    expect(formatTokenNumber(1000000)).toBe('1.0M');
  });
});
