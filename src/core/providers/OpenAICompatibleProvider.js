/**
 * OpenAICompatibleProvider - Custom OpenAI Compatible API Adapter
 * (NVIDIA NIM, OpenAI, OpenRouter, Groq, DeepSeek, Local Ollama, LM Studio, etc.)
 * 
 * Features:
 * 1. Unified Multi-Field SSE Parser (reasoning, content, tool_calls, usage, finish_reason).
 * 2. Usage-first parsing (supports chunks containing only usage metadata).
 * 3. Tool Calling Capability State Machine (supported / unsupported / unknown with graceful fallback).
 * 4. Android Native Stream & Web Fetch fallback.
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
    this.toolCapabilities = new Map(); // modelId -> 'supported' | 'unsupported' | 'unknown'
    this.supportsStreamOptions = true;
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
        return { success: true, message: `連線成功 (獲取到 ${count} 個可用模型)` };
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
   * Unified SSE line parser:
   * 1. Extracts top-level usage first (even if choices array is empty)
   * 2. Extracts reasoning across all vendor formats
   * 3. Extracts regular content
   * 4. Extracts tool_calls
   * 5. Extracts finish_reason
   * Does NOT early-return and drop co-existing fields.
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
      const res = {
        type: 'chunk',
        reasoning: null,
        content: null,
        tool_calls: null,
        usage: null,
        finish_reason: null
      };

      // 1. Top-level usage extraction (important for usage-only final chunks)
      if (chunk.usage && typeof chunk.usage === 'object') {
        res.usage = chunk.usage;
      }

      const choice = chunk.choices?.[0];
      if (choice) {
        if (choice.finish_reason) {
          res.finish_reason = choice.finish_reason;
        }

        const delta = choice.delta || choice.message;
        if (delta) {
          // Multi-format reasoning extraction
          const rawReasoning = delta.reasoning_content ||
            delta.reasoning ||
            delta.thinking ||
            delta.thought ||
            delta.thoughts ||
            delta.analysis ||
            choice.reasoning_content ||
            choice.reasoning ||
            choice.thinking;

          if (rawReasoning && typeof rawReasoning === 'string') {
            res.reasoning = rawReasoning.replace(/\uE000+/g, '');
          }

          // Content extraction
          if (delta.content && typeof delta.content === 'string') {
            res.content = delta.content.replace(/\uE000+/g, '');
          }

          // Tool calls extraction
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            res.tool_calls = delta.tool_calls;
          }
        }
      }

      if (res.usage || res.reasoning || res.content || res.tool_calls || res.finish_reason) {
        return res;
      }
    } catch (_) {
      // Ignore unparseable line
    }
    return null;
  }

  /**
   * Tool calling capability check with state machine
   */
  getToolCallingCapability(modelId) {
    if (!modelId) return 'unsupported';
    if (this.toolCapabilities.has(modelId)) {
      return this.toolCapabilities.get(modelId);
    }
    const lower = modelId.toLowerCase();
    // Known supported models
    if (
      lower.includes('gpt-4') || lower.includes('gpt-3.5') ||
      lower.includes('claude-3') || lower.includes('mistral') ||
      lower.includes('llama-3.1') || lower.includes('llama-3.3') ||
      lower.includes('qwen2.5') || lower.includes('qwen-2.5') ||
      lower.includes('deepseek-chat')
    ) {
      return 'supported';
    }
    // Known unsupported models
    if (
      lower.includes('embed') || lower.includes('rerank') ||
      lower.includes('guard') || lower.includes('reward')
    ) {
      return 'unsupported';
    }
    return 'unknown';
  }

  supportsToolCalling(modelId) {
    return this.getToolCallingCapability(modelId) !== 'unsupported';
  }

  setToolCallingCapability(modelId, capability) {
    this.toolCapabilities.set(modelId, capability);
  }

  async *chatStream({ model, messages, temperature = 0.7, max_tokens = 8192, signal, tools = null }) {
    let activeTools = (tools && tools.length > 0 && this.supportsToolCalling(model)) ? tools : null;

    const buildPayload = (includeTools, includeUsage) => ({
      model,
      messages,
      temperature,
      max_tokens,
      stream: true,
      ...(includeTools && activeTools ? { tools: activeTools, tool_choice: 'auto' } : {}),
      ...(includeUsage && this.supportsStreamOptions ? { stream_options: { include_usage: true } } : {})
    });

    const headers = {
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      ...this.customHeaders
    };

    const url = `${this.baseUrl}/chat/completions`;

    // Internal execution generator
    const executeStream = async function* (payload) {
      // 1. Android Native Streaming
      if (NativeStreamClient.isAvailable()) {
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
      }

      // 2. Web Fetch Stream
      const response = await HttpClient.streamFetch(url, {
        headers,
        body: payload,
        signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`API Error (HTTP ${response.status}): ${sanitizeLog(errorText)}`);
        err.status = response.status;
        err.body = errorText;
        throw err;
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
    }.bind(this);

    // Try initial streaming request with capability fallback
    try {
      const payload = buildPayload(Boolean(activeTools), true);
      for await (const chunk of executeStream(payload)) {
        yield chunk;
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        yield { type: 'done', delta: '' };
        return;
      }

      // Check if error was caused by stream_options or tools rejecting in unknown model
      const errMsg = (err.message || '').toLowerCase();
      const isToolError = activeTools && (errMsg.includes('tool') || errMsg.includes('function') || errMsg.includes('extra') || err.status === 400);
      const isStreamOptionError = this.supportsStreamOptions && (errMsg.includes('stream_options') || err.status === 400);

      if (isToolError || isStreamOptionError) {
        if (isToolError) {
          this.setToolCallingCapability(model, 'unsupported');
          activeTools = null;
        }
        if (isStreamOptionError) {
          this.supportsStreamOptions = false;
        }

        // Retry without unsupported options
        try {
          const fallbackPayload = buildPayload(false, false);
          for await (const chunk of executeStream(fallbackPayload)) {
            yield chunk;
          }
          return;
        } catch (retryErr) {
          yield { type: 'error', delta: `連線失敗: ${sanitizeLog(retryErr.message)}` };
          return;
        }
      }

      yield { type: 'error', delta: `連線失敗: ${sanitizeLog(err.message)}` };
    }
  }
}
