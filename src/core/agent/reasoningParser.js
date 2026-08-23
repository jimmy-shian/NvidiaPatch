/**
 * Streaming Reasoning & Think-Tag Parser
 * Handles:
 * 1. Explicit delta.reasoning_content / delta.reasoning / delta.thinking
 * 2. In-band streaming <think>...</think> and <thought>...</thought> tags inside delta.content
 * 3. Tag boundary buffering (when <think> or </think> splits across chunk boundaries)
 * 4. NVIDIA / Llama \uE000 / <|thought|> special tokens
 */

export class StreamReasoningParser {
  constructor({ onThinking, onContent }) {
    this.onThinking = onThinking;
    this.onContent = onContent;
    this.isInsideThink = false;
    this.pendingBuffer = '';
    this.hasEmittedThinking = false;
  }

  /**
   * Process a single incoming chunk from the provider stream
   * @param {Object} chunk
   */
  processChunk(chunk) {
    if (!chunk) return;

    // 1. Explicit reasoning field in delta (e.g. DeepSeek / NIM native reasoning_content)
    const explicitReasoning = chunk.delta?.reasoning_content || chunk.delta?.reasoning || chunk.delta?.thinking || (chunk.type === 'thinking' ? chunk.delta : null);
    if (explicitReasoning && typeof explicitReasoning === 'string') {
      const cleanReasoning = explicitReasoning.replace(/\uE000+/g, '').replace(/<\|?thought\|?>/g, '');
      if (cleanReasoning) {
        this.hasEmittedThinking = true;
        this.onThinking?.(cleanReasoning);
      }
    }

    // 2. Content delta (may contain in-band <think>...</think> or <thought>...</thought>)
    const content = chunk.delta?.content ?? (chunk.type === 'content' ? chunk.delta : null);
    if (content && typeof content === 'string') {
      this.parseContentStream(content);
    }
  }

  parseContentStream(chunkText) {
    let text = this.pendingBuffer + chunkText;
    this.pendingBuffer = '';

    while (text.length > 0) {
      if (!this.isInsideThink) {
        // Look for start tags: <think>, <thought>, <|thought|>
        const thinkMatch = text.search(/<think>|<thought>|<\|thought\|>/i);

        if (thinkMatch === -1) {
          // Check if the end of text could be a partial start tag like "<th", "<", "<|th"
          const partialMatch = text.match(/<[a-z|]{0,8}$/i);
          if (partialMatch) {
            const safeContent = text.slice(0, partialMatch.index);
            if (safeContent) this.onContent?.(safeContent);
            this.pendingBuffer = text.slice(partialMatch.index);
            text = '';
          } else {
            this.onContent?.(text);
            text = '';
          }
        } else {
          // Content before <think>
          const before = text.slice(0, thinkMatch);
          if (before) this.onContent?.(before);

          // Find exact matched start tag length
          const matchStr = text.slice(thinkMatch).match(/^(<think>|<thought>|<\|thought\|>)/i)?.[0] || '';
          this.isInsideThink = true;
          this.hasEmittedThinking = true;
          text = text.slice(thinkMatch + matchStr.length);
        }
      } else {
        // Inside thinking, look for end tags: </think>, </thought>, <|/thought|>, <|endofthought|>
        const endMatch = text.search(/<\/think>|<\/thought>|<\|\/thought\|>|<\|endofthought\|>/i);

        if (endMatch === -1) {
          // Check if end of text could be a partial end tag like "</th", "</", "<|/"
          const partialMatch = text.match(/<[/|][a-z|]{0,12}$/i);
          if (partialMatch) {
            const safeThinking = text.slice(0, partialMatch.index);
            if (safeThinking) this.onThinking?.(safeThinking);
            this.pendingBuffer = text.slice(partialMatch.index);
            text = '';
          } else {
            this.onThinking?.(text);
            text = '';
          }
        } else {
          // Thinking before </think>
          const thinkText = text.slice(0, endMatch);
          if (thinkText) this.onThinking?.(thinkText);

          // Find exact matched end tag length
          const matchStr = text.slice(endMatch).match(/^(<\/think>|<\/thought>|<\|\/thought\|>|<\|endofthought\|>)/i)?.[0] || '';
          this.isInsideThink = false;
          text = text.slice(endMatch + matchStr.length);
        }
      }
    }
  }

  /**
   * Flush any remaining buffered characters at the end of the stream
   */
  flush() {
    if (this.pendingBuffer) {
      if (this.isInsideThink) {
        this.onThinking?.(this.pendingBuffer);
      } else {
        this.onContent?.(this.pendingBuffer);
      }
      this.pendingBuffer = '';
    }
  }
}
