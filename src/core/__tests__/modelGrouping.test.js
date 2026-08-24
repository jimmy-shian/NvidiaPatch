import { describe, it, expect } from 'vitest';
import { groupModelsByFamily } from '../../components/Chat/ModelSelectorModal';

describe('Model Selector Grouping', () => {
  it('groups models by family accurately', () => {
    const rawList = [
      { id: 'nvidia/llama-3.1-nemotron-120b-instruct', name: 'Nemotron 120B' },
      { id: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash' },
      { id: 'minimaxai/minimax-m3', name: 'MiniMax M3' },
      { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B' },
      { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2' },
      { id: 'some-custom-vendor/custom-llm', name: 'Custom LLM' }
    ];

    const groups = groupModelsByFamily(rawList);
    const keys = groups.map(g => g.key);

    expect(keys).toContain('nemotron');
    expect(keys).toContain('deepseek');
    expect(keys).toContain('minimax');
    expect(keys).toContain('openai');
    expect(keys).toContain('llama');
    expect(keys).toContain('qwen');
    expect(keys).toContain('mistral');
    expect(keys).toContain('other');

    const nemotronGroup = groups.find(g => g.key === 'nemotron');
    expect(nemotronGroup.models[0].id).toBe('nvidia/llama-3.1-nemotron-120b-instruct');

    const deepseekGroup = groups.find(g => g.key === 'deepseek');
    expect(deepseekGroup.models[0].id).toBe('deepseek-ai/deepseek-v4-flash-0731');

    const minimaxGroup = groups.find(g => g.key === 'minimax');
    expect(minimaxGroup.models[0].id).toBe('minimaxai/minimax-m3');
  });
});
