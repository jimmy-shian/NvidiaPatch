/**
 * ProviderAdapter Base Class
 * 
 * Defines standard contract for all LLM providers (NVIDIA NIM, OpenAI, Groq, Ollama, etc.)
 */
export class ProviderAdapter {
  constructor(config = {}) {
    this.id = config.id || 'custom';
    this.name = config.name || 'Custom Provider';
    this.baseUrl = config.baseUrl || '';
    this.apiKey = config.apiKey || '';
    this.customHeaders = config.customHeaders || {};
  }

  /**
   * Test API key & connection validity
   */
  async testConnection() {
    throw new Error('testConnection() not implemented');
  }

  /**
   * Fetch available models from the provider
   */
  async listModels() {
    throw new Error('listModels() not implemented');
  }

  /**
   * Stream chat completion chunks
   * @param {Object} options - { model, messages, temperature, max_tokens, signal, tools }
   * @yields {Object} - { type: 'content' | 'thinking' | 'tool_call' | 'done' | 'error', delta: string, data?: any }
   */
  async *chatStream(options) {
    throw new Error('chatStream() not implemented');
  }

  /**
   * Check if a specific model supports native tool calling
   */
  supportsToolCalling(modelId) {
    return false;
  }

  /**
   * Compatibility stream generator method
   */
  async *sendMessageStream({ model, messages, systemInstruction, ...rest }) {
    const finalMessages = [...(messages || [])];
    if (systemInstruction && !finalMessages.some(m => m.role === 'system')) {
      finalMessages.unshift({ role: 'system', content: systemInstruction });
    }
    for await (const chunk of this.chatStream({ model, messages: finalMessages, ...rest })) {
      const text = chunk.content || chunk.delta || '';
      const type = chunk.content ? 'content' : chunk.reasoning ? 'thinking' : (chunk.type || 'content');
      yield {
        type,
        text,
        ...chunk
      };
    }
  }
}
