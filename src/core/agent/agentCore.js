/**
 * AgentCore - Mobile AI Agent Controller
 */
import { buildCompleteMessages } from './promptBuilder';
import { StreamReasoningParser } from './reasoningParser';

export class AgentCore {
  constructor(providerAdapter) {
    this.provider = providerAdapter;
    this.abortController = null;
  }

  setProvider(providerAdapter) {
    this.provider = providerAdapter;
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Run chat generation stream
   * @param {Object} params
   * @param {Array} params.messages - History + current user message
   * @param {string} params.model - Model identifier
   * @param {Array<string>} params.selectedSkillIds - Array of skill IDs
   * @param {Function} params.onThinking - Callback for reasoning / thinking stream
   * @param {Function} params.onContent - Callback for regular content stream
   * @param {Function} params.onDone - Callback when stream finishes
   * @param {Function} params.onError - Callback on error
   */
  async runChat({
    messages,
    model,
    selectedSkillIds = [],
    temperature = 0.7,
    max_tokens = 4096,
    onThinking,
    onContent,
    onDone,
    onError
  }) {
    if (!this.provider) {
      onError?.(new Error('No active LLM Provider configured'));
      return;
    }

    this.abortController = new AbortController();

    // Instantiate streaming reasoning parser for handling in-band <think> and native delta.reasoning
    const reasoningParser = new StreamReasoningParser({
      onThinking: (delta) => {
        onThinking?.(delta);
      },
      onContent: (delta) => {
        onContent?.(delta);
      }
    });

    try {
      // Assemble full payload with system prompts, context, and skills
      const completeMessages = await buildCompleteMessages({
        messages,
        selectedSkillIds
      });

      const stream = this.provider.chatStream({
        model,
        messages: completeMessages,
        temperature,
        max_tokens,
        signal: this.abortController.signal
      });

      for await (const chunk of stream) {
        if (chunk.type === 'thinking') {
          reasoningParser.processChunk({ delta: { reasoning_content: chunk.delta } });
        } else if (chunk.type === 'content') {
          reasoningParser.processChunk({ delta: { content: chunk.delta } });
        } else if (chunk.type === 'error') {
          onError?.(new Error(chunk.delta));
          return;
        } else if (chunk.type === 'done') {
          reasoningParser.flush();
          onDone?.();
          return;
        }
      }

      reasoningParser.flush();
      onDone?.();
    } catch (err) {
      if (err.name === 'AbortError') {
        reasoningParser.flush();
        onDone?.();
      } else {
        onError?.(err);
      }
    } finally {
      this.abortController = null;
    }
  }
}
