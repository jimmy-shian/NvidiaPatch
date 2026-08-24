import { describe, it, expect } from 'vitest';
import { StreamReasoningParser } from '../agent/reasoningParser';

describe('StreamReasoningParser', () => {
  it('should parse explicit delta.reasoning_content chunks', () => {
    let thinking = '';
    let content = '';

    const parser = new StreamReasoningParser({
      onThinking: (d) => { thinking += d; },
      onContent: (d) => { content += d; }
    });

    parser.processChunk({ delta: { reasoning_content: 'Let me think step 1. ' } });
    parser.processChunk({ delta: { reasoning_content: 'Step 2 logic verified.' } });
    parser.processChunk({ delta: { content: 'Hello, this is the final answer.' } });
    parser.flush();

    expect(thinking).toBe('Let me think step 1. Step 2 logic verified.');
    expect(content).toBe('Hello, this is the final answer.');
  });

  it('should parse delta.reasoning, delta.thinking, delta.thought, and delta.analysis', () => {
    let thinking = '';
    let content = '';

    const parser = new StreamReasoningParser({
      onThinking: (d) => { thinking += d; },
      onContent: (d) => { content += d; }
    });

    parser.processChunk({ reasoning: 'GPT-OSS reasoning text. ' });
    parser.processChunk({ delta: { thinking: 'Claude thinking text. ' } });
    parser.processChunk({ delta: { thought: 'Qwen thought text. ' } });
    parser.processChunk({ delta: { analysis: 'DeepSeek analysis text.' } });
    parser.processChunk({ content: 'Result content.' });
    parser.flush();

    expect(thinking).toBe('GPT-OSS reasoning text. Claude thinking text. Qwen thought text. DeepSeek analysis text.');
    expect(content).toBe('Result content.');
    expect(parser.hasEmittedThinking).toBe(true);
  });

  it('should parse in-band <think>...</think> and [THINK] tags inside content stream', () => {
    let thinking = '';
    let content = '';

    const parser = new StreamReasoningParser({
      onThinking: (d) => { thinking += d; },
      onContent: (d) => { content += d; }
    });

    parser.processChunk({ delta: { content: '<think>Analyzing user question...' } });
    parser.processChunk({ delta: { content: ' Finding best solution.</think>Here is the solution.' } });
    parser.flush();

    expect(thinking).toBe('Analyzing user question... Finding best solution.');
    expect(content).toBe('Here is the solution.');
  });

  it('should handle <think> tags split across chunk boundaries', () => {
    let thinking = '';
    let content = '';

    const parser = new StreamReasoningParser({
      onThinking: (d) => { thinking += d; },
      onContent: (d) => { content += d; }
    });

    parser.processChunk({ delta: { content: 'Intro text <th' } });
    parser.processChunk({ delta: { content: 'ink>Deep thought in prog' } });
    parser.processChunk({ delta: { content: 'ress</th' } });
    parser.processChunk({ delta: { content: 'ink>Final answer text.' } });
    parser.flush();

    expect(thinking).toBe('Deep thought in progress');
    expect(content).toBe('Intro text Final answer text.');
  });

  it('should pass normal content directly when no thinking tags exist', () => {
    let thinking = '';
    let content = '';

    const parser = new StreamReasoningParser({
      onThinking: (d) => { thinking += d; },
      onContent: (d) => { content += d; }
    });

    parser.processChunk({ delta: { content: 'Direct response without any thinking tags.' } });
    parser.flush();

    expect(thinking).toBe('');
    expect(content).toBe('Direct response without any thinking tags.');
    expect(parser.hasEmittedThinking).toBe(false);
  });
});
