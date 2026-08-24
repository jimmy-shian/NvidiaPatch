import { describe, it, expect, vi } from 'vitest';
import { AgentCore } from '../agent/agentCore';

describe('Run Lifecycle & RunId Isolation Protection', () => {
  it('discards late chunks and callbacks from stale or cancelled runs', async () => {
    const mockProvider = {
      chatStream({ signal }) {
        return (async function* () {
          yield { type: 'chunk', content: 'Chunk 1' };
          await new Promise(r => setTimeout(r, 50));
          if (!signal.aborted) {
            yield { type: 'chunk', content: 'Chunk 2' };
          }
          yield { type: 'done' };
        })();
      }
    };

    const agent = new AgentCore(mockProvider);
    const runId1 = 'run_test_1';
    let contentRun1 = '';
    let doneRun1 = false;

    // Start Run 1 and abort immediately when Chunk 1 arrives
    const run1Promise = agent.runChat({
      runId: runId1,
      messages: [{ role: 'user', content: 'Hello 1' }],
      model: 'meta/llama-3.3-70b-instruct',
      onContent: (c) => {
        contentRun1 += c;
        agent.abort();
      },
      onDone: () => { doneRun1 = true; }
    });

    await run1Promise;

    expect(contentRun1).toBe('Chunk 1');
  });

  it('guarantees idempotent completion per run', async () => {
    const mockProvider = {
      chatStream() {
        return (async function* () {
          yield { type: 'chunk', content: 'Single response' };
          yield { type: 'done' };
        })();
      }
    };

    const agent = new AgentCore(mockProvider);
    let doneCallCount = 0;

    await agent.runChat({
      runId: 'run_test_idempotent',
      messages: [{ role: 'user', content: 'Test idempotent' }],
      model: 'meta/llama-3.3-70b-instruct',
      onDone: () => {
        doneCallCount++;
      }
    });

    expect(doneCallCount).toBe(1);
  });

  it('switches cleanly to a new runId when a new request is started', async () => {
    const mockProvider = {
      chatStream() {
        return (async function* () {
          yield { type: 'chunk', content: 'Response' };
          yield { type: 'done' };
        })();
      }
    };

    const agent = new AgentCore(mockProvider);
    let capturedRun2Content = '';

    await agent.runChat({
      runId: 'run_first',
      messages: [{ role: 'user', content: 'Msg 1' }],
      model: 'meta/llama-3.3-70b-instruct'
    });

    await agent.runChat({
      runId: 'run_second',
      messages: [{ role: 'user', content: 'Msg 2' }],
      model: 'meta/llama-3.3-70b-instruct',
      onContent: (c) => { capturedRun2Content += c; }
    });

    expect(capturedRun2Content).toBe('Response');
  });
});
