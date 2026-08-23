/**
 * OpenAICompatibleProvider - Custom OpenAI Compatible API Adapter
 * (NVIDIA NIM, OpenAI, OpenRouter, Groq, DeepSeek, Local Ollama, LM Studio, etc.)
 */
import { ProviderAdapter } from './ProviderAdapter';
import { HttpClient } from '../network/httpClient';
import { NativeStreamClient } from '../network/nativeStreamClient';
import { sanitizeLog } from '../security/secureStorage';

export class OpenAICompatibleProvider extends ProviderAdapter {
  constructor(config = {}) {
    super({
      id: config.id || 'openai_compat',
      name: config.name || 'OpenAI Compatible',
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      apiKey: config.apiKey || '',
      ...config
    });
  }

  async testConnection() {
    try {
      const res = await HttpClient.request({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: {
          ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
          ...this.customHeaders
        },
        timeout: 10000
      });

      if (res.ok) {
        const count = Array.isArray(res.data?.data) ? res.data.data.length : 0;
        return { success: true, message: `Connected successfully (${count} models found)` };
      }
      return { success: false, message: `HTTP ${res.status}: ${JSON.stringify(res.data)}` };
    } catch (err) {
      return { success: false, message: sanitizeLog(err.message) };
    }
  }

  async listModels() {
    try {
      const res = await HttpClient.request({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: {
          ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
          ...this.customHeaders
        }
      });

      if (res.ok && Array.isArray(res.data?.data)) {
        return res.data.data.map(m => ({
          id: m.id,
          name: m.id,
          vendor: this.name,
          created: m.created
        }));
      }
      return [];
    } catch (err) {
      console.error('[OpenAICompatible listModels error]:', sanitizeLog(err.message));
      return [];
    }
  }

  /**
   * SSE line parser: Extracts thinking/reasoning, content, tool_calls, done
   */
  _parseSseLine(line) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return null;
    const dataStr = trimmed.slice(5).trim();
    if (dataStr === '[DONE]') {
      return { type: 'done', delta: '' };
    }

    try {
      const chunk = JSON.parse(dataStr);
      const choice = chunk.choices?.[0];
      if (!choice) return null;

      const delta = choice.delta;
      if (!delta) return null;

      if (delta.reasoning_content || delta.reasoning) {
        const r = delta.reasoning_content || delta.reasoning;
        if (r) return { type: 'thinking', delta: r };
      }

      if (delta.content) {
        return { type: 'content', delta: delta.content };
      }

      if (delta.tool_calls) {
        return { type: 'tool_call', delta: '', data: delta.tool_calls };
      }
    } catch (_) {
      // Ignore malformed chunk
    }
    return null;
  }

  async *chatStream({ model, messages, temperature = 0.7, max_tokens = 8192, signal, tools = null }) {
    const payload = {
      model,
      messages,
      temperature,
      max_tokens,
      stream: true,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {})
    };

    const headers = {
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      ...this.customHeaders
    };

    const url = `${this.baseUrl}/chat/completions`;

    // 1. Android Native Streaming Path (Zero CORS restrictions, True Line-by-Line SSE)
    if (NativeStreamClient.isAvailable()) {
      try {
        const nativeStream = NativeStreamClient.stream({
          url,
          headers,
          body: payload,
          signal
        });

        for await (const line of nativeStream) {
          const parsed = this._parseSseLine(line);
          if (parsed) {
            yield parsed;
            if (parsed.type === 'done') return;
          }
        }
        yield { type: 'done', delta: '' };
        return;
      } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) {
          yield { type: 'done', delta: '' };
          return;
        }
        yield { type: 'error', delta: `Connection Error: ${sanitizeLog(err.message)}` };
        return;
      }
    }

    // 2. Standard Web Fetch Stream Fallback (for Browser development)
    try {
      const response = await HttpClient.streamFetch(url, {
        headers,
        body: payload,
        signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield { type: 'error', delta: `API Error (HTTP ${response.status}): ${sanitizeLog(errorText)}` };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const parsed = this._parseSseLine(line);
          if (parsed) {
            yield parsed;
            if (parsed.type === 'done') return;
          }
        }
      }

      yield { type: 'done', delta: '' };
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        yield { type: 'done', delta: '' };
        return;
      }
      yield { type: 'error', delta: `Connection Error: ${sanitizeLog(err.message)}` };
    }
  }

  supportsToolCalling(modelId) {
    if (!modelId) return false;
    const lower = modelId.toLowerCase();
    return lower.includes('gpt-') || lower.includes('claude-') || lower.includes('mistral') || lower.includes('qwen');
  }
}
