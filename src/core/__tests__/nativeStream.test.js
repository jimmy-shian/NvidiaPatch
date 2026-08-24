import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../providers/OpenAICompatibleProvider';
import { NativeStreamClient } from '../network/nativeStreamClient';

describe('NativeStreamClient & Stream SSE Parser', () => {
  it('should detect when NativeStreamBridge is absent in node environment', () => {
    expect(NativeStreamClient.isAvailable()).toBe(false);
  });

  it('should correctly parse standard SSE data lines into unified chunk events', () => {
    const provider = new OpenAICompatibleProvider();
    
    // 1. Content delta
    const contentChunk = provider._parseSseLine('data: {"choices":[{"delta":{"content":"Hello world"}}]}');
    expect(contentChunk.type).toBe('chunk');
    expect(contentChunk.content).toBe('Hello world');

    // 2. Reasoning delta
    const reasoningChunk = provider._parseSseLine('data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}');
    expect(reasoningChunk.type).toBe('chunk');
    expect(reasoningChunk.reasoning).toBe('Let me think');

    // 3. Usage-only chunk (parsed even when choices is missing)
    const usageChunk = provider._parseSseLine('data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}');
    expect(usageChunk.type).toBe('chunk');
    expect(usageChunk.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

    // 4. DONE signal
    const doneChunk = provider._parseSseLine('data: [DONE]');
    expect(doneChunk).toEqual({ type: 'done', delta: '' });

    // 5. Invalid or empty lines
    expect(provider._parseSseLine('')).toBeNull();
    expect(provider._parseSseLine(': keepalive')).toBeNull();
    expect(provider._parseSseLine('data: malformed json')).toBeNull();
  });
});
