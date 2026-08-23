import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../providers/OpenAICompatibleProvider';
import { NativeStreamClient } from '../network/nativeStreamClient';

describe('NativeStreamClient & Stream SSE Parser', () => {
  it('should detect when NativeStreamBridge is absent in node environment', () => {
    expect(NativeStreamClient.isAvailable()).toBe(false);
  });

  it('should correctly parse standard SSE data lines', () => {
    const provider = new OpenAICompatibleProvider();
    
    // 1. Content delta
    const contentChunk = provider._parseSseLine('data: {"choices":[{"delta":{"content":"Hello world"}}]}');
    expect(contentChunk).toEqual({ type: 'content', delta: 'Hello world' });

    // 2. Reasoning delta
    const reasoningChunk = provider._parseSseLine('data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}');
    expect(reasoningChunk).toEqual({ type: 'thinking', delta: 'Let me think' });

    // 3. DONE signal
    const doneChunk = provider._parseSseLine('data: [DONE]');
    expect(doneChunk).toEqual({ type: 'done', delta: '' });

    // 4. Invalid or empty lines
    expect(provider._parseSseLine('')).toBeNull();
    expect(provider._parseSseLine(': keepalive')).toBeNull();
    expect(provider._parseSseLine('data: malformed json')).toBeNull();
  });
});
