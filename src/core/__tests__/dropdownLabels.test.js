import { describe, it, expect } from 'vitest';
import { getProviderDisplayLabel, getModelDisplayLabel } from '../../components/Settings/ProviderConfigTab';
import { PROVIDER_TYPES } from '../providers';

describe('Provider and Model Display Labels', () => {
  it('should resolve provider display labels with proper fallbacks', () => {
    expect(getProviderDisplayLabel({ id: 'nvidia', name: 'NVIDIA NIM' })).toBe('NVIDIA NIM');
    expect(getProviderDisplayLabel({ id: 'openai', displayName: 'OpenAI Direct' })).toBe('OpenAI Direct');
    expect(getProviderDisplayLabel({ id: 'custom' })).toBe('custom');
    expect(getProviderDisplayLabel(null)).toBe('');
  });

  it('should ensure all predefined PROVIDER_TYPES have non-empty valid names and IDs', () => {
    expect(PROVIDER_TYPES.length).toBeGreaterThanOrEqual(4);
    for (const p of PROVIDER_TYPES) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(getProviderDisplayLabel(p)).toBeTruthy();
    }
  });

  it('should resolve model display labels with proper fallbacks', () => {
    expect(getModelDisplayLabel({ id: 'nvidia/llama-3.1-nemotron-120b-instruct', name: 'Nemotron 120B' })).toBe('Nemotron 120B');
    expect(getModelDisplayLabel({ id: 'custom/model-id' })).toBe('custom/model-id');
    expect(getModelDisplayLabel('string-model-id')).toBe('string-model-id');
    expect(getModelDisplayLabel(null)).toBe('');
  });
});
