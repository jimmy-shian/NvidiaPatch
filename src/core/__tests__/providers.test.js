import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProvider, PROVIDER_TYPES } from '../providers';
import { NvidiaNimProvider } from '../providers/NvidiaNimProvider';
import { OpenAICompatibleProvider, getNextTokenTier, isMaxTokensRejection } from '../providers/OpenAICompatibleProvider';
import { HttpClient } from '../network/httpClient';
import { NativeStreamClient } from '../network/nativeStreamClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Provider Factory & Adapters', () => {
  it('creates NVIDIA NIM provider with defaults and capability detection', () => {
    const provider = createProvider('nvidia', { apiKey: 'nvapi-test' });
    expect(provider).toBeInstanceOf(NvidiaNimProvider);
    expect(provider.id).toBe('nvidia');
    expect(provider.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(provider.getToolCallingCapability('meta/llama-3.1-70b-instruct')).toBe('supported');
    expect(provider.getToolCallingCapability('nvidia/embed-qa-4')).toBe('unsupported');
    expect(provider.getToolCallingCapability('unknown-model-id')).toBe('unknown');
    expect(provider.supportsToolCalling('nvidia/embed-qa-4')).toBe(false);
  });

  it('creates OpenAI Compatible provider with custom URL', () => {
    const provider = createProvider('openai_compat', {
      baseUrl: 'https://my-custom-proxy.com/v1',
      apiKey: 'sk-custom'
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.baseUrl).toBe('https://my-custom-proxy.com/v1');
  });

  it('registers expected provider types', () => {
    const ids = PROVIDER_TYPES.map(p => p.id);
    expect(ids).toContain('nvidia');
    expect(ids).toContain('openai_compat');
    expect(ids).toContain('groq');
    expect(ids).toContain('ollama');
  });

  it('steps down max_tokens from 32768 -> 16384 -> 8192 when upstream rejects large token limits', async () => {
    vi.spyOn(NativeStreamClient, 'isAvailable').mockReturnValue(false);
    const seenMaxTokens = [];

    vi.spyOn(HttpClient, 'streamFetch').mockImplementation(async (_url, { body }) => {
      seenMaxTokens.push(body.max_tokens);
      if (body.max_tokens > 8192) {
        return {
          ok: false,
          status: 422,
          text: async () => `Input should be less than or equal to 8192 for max_tokens`
        };
      }
      const sseBytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"OK-8K"}}]}\n\ndata: [DONE]\n\n');
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: sseBytes };
              }
            };
          }
        }
      };
    });

    const nimProvider = createProvider('nvidia', { apiKey: 'nvapi-test' });
    const chunks = [];
    for await (const c of nimProvider.chatStream({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: 'hi' }]
    })) {
      chunks.push(c);
    }

    expect(seenMaxTokens).toEqual([32768, 16384, 8192]);
    expect(chunks.some(c => c.content === 'OK-8K')).toBe(true);
    expect(getNextTokenTier(32768)).toBe(16384);
    expect(getNextTokenTier(16384)).toBe(8192);
    expect(getNextTokenTier(8192)).toBe(4096);
    expect(getNextTokenTier(4096)).toBeNull();
    expect(isMaxTokensRejection(422, 'max_tokens too large')).toBe(true);
  });
});
