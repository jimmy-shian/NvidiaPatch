import { describe, it, expect } from 'vitest';
import { createProvider, PROVIDER_TYPES } from '../providers';
import { NvidiaNimProvider } from '../providers/NvidiaNimProvider';
import { OpenAICompatibleProvider } from '../providers/OpenAICompatibleProvider';

describe('Provider Factory & Adapters', () => {
  it('creates NVIDIA NIM provider with defaults', () => {
    const provider = createProvider('nvidia', { apiKey: 'nvapi-test' });
    expect(provider).toBeInstanceOf(NvidiaNimProvider);
    expect(provider.id).toBe('nvidia');
    expect(provider.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(provider.supportsToolCalling('meta/llama-3.1-70b-instruct')).toBe(true);
    expect(provider.supportsToolCalling('some-other-model')).toBe(false);
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
});
