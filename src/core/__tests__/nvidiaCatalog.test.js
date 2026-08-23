import { describe, it, expect } from 'vitest';
import { extractBuildFreeEndpointModelsFromHtml, normalizeBuildModelId, sortNvidiaModels } from '../providers/nvidiaModelCatalog';

describe('NVIDIA Model Catalog & Crawler', () => {
  it('should correctly normalize model IDs and reject blocked prefixes', () => {
    expect(normalizeBuildModelId('nvidia', 'llama-3.1-nemotron-120b-instruct')).toBe('nvidia/llama-3.1-nemotron-120b-instruct');
    expect(normalizeBuildModelId('meta', 'llama-3.3-70b-instruct')).toBe('meta/llama-3.3-70b-instruct');
    expect(normalizeBuildModelId('models', 'explore')).toBeNull();
    expect(normalizeBuildModelId('api', 'v1')).toBeNull();
    expect(normalizeBuildModelId('_next', 'static')).toBeNull();
  });

  it('should extract models from mock HTML with href and json structures', () => {
    const mockHtml = `
      <div>
        <a href="/nvidia/llama-3.1-nemotron-120b-instruct">Nemotron 120B</a>
        <a href="https://build.nvidia.com/meta/llama-3.3-70b-instruct">Llama 3.3</a>
        <script>{"model":"deepseek-ai/deepseek-r1"}</script>
        <a href="/models/explore">Invalid Link</a>
      </div>
    `;
    const models = extractBuildFreeEndpointModelsFromHtml(mockHtml);
    expect(models.length).toBe(3);
    expect(models.map(m => m.id)).toContain('nvidia/llama-3.1-nemotron-120b-instruct');
    expect(models.map(m => m.id)).toContain('meta/llama-3.3-70b-instruct');
    expect(models.map(m => m.id)).toContain('deepseek-ai/deepseek-r1');
  });

  it('should prioritize flagship models at the top of sorted list', () => {
    const raw = [
      { id: 'random/model-a', name: 'Model A' },
      { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
      { id: 'nvidia/llama-3.1-nemotron-120b-instruct', name: 'Nemotron 120B' }
    ];
    const sorted = sortNvidiaModels(raw);
    expect(sorted[0].id).toBe('nvidia/llama-3.1-nemotron-120b-instruct');
    expect(sorted[1].id).toBe('meta/llama-3.1-405b-instruct');
    expect(sorted[2].id).toBe('random/model-a');
  });
});
