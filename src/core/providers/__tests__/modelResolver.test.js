import { describe, it, expect } from 'vitest';
import { resolveUpstreamModelId, normalizeSymbolKey } from '../modelResolver';
import { NvidiaNimProvider } from '../NvidiaNimProvider';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';

describe('Upstream Model ID Resolver & Provider Integration', () => {
  it('should normalize symbol keys properly', () => {
    expect(normalizeSymbolKey('z-ai/glm-5-3-flash')).toBe('zai/glm53flash');
    expect(normalizeSymbolKey('z-ai/glm-5.3-flash')).toBe('zai/glm53flash');
  });

  it('should return exact match unchanged', () => {
    expect(resolveUpstreamModelId('z-ai/glm-5.3')).toBe('z-ai/glm-5.3');
    expect(resolveUpstreamModelId('z-ai/glm-5.3-flash')).toBe('z-ai/glm-5.3-flash');
    expect(resolveUpstreamModelId('google/gemma-2b')).toBe('google/gemma-2b');
  });

  it('should resolve hyphen to dot for known aliases right before sending', () => {
    expect(resolveUpstreamModelId('z-ai/glm-5-3')).toBe('z-ai/glm-5.3');
    expect(resolveUpstreamModelId('z-ai/glm-5-3-flash')).toBe('z-ai/glm-5.3-flash');
    expect(resolveUpstreamModelId('moonshotai/kimi-k2-6')).toBe('moonshotai/kimi-k2.6');
    expect(resolveUpstreamModelId('microsoft/phi-3-5-moe-instruct')).toBe('microsoft/phi-3.5-moe-instruct');
  });

  it('should fuzzy resolve unknown hyphen/dot variations against candidate list', () => {
    const candidates = ['custom/model-1.2.3-v1', 'foo/bar-9.0'];
    expect(resolveUpstreamModelId('custom/model-1-2-3-v1', candidates)).toBe('custom/model-1.2.3-v1');
    expect(resolveUpstreamModelId('foo/bar-9-0', candidates)).toBe('foo/bar-9.0');
  });

  it('should keep original model ID if no match found', () => {
    expect(resolveUpstreamModelId('nonexistent/some-model')).toBe('nonexistent/some-model');
  });
});
