/**
 * NvidiaNimProvider - NVIDIA NIM LLM Integration
 * Features full model catalog crawling, normalization, filtering, NativeStreamBridge SSE streaming,
 * unified multi-field SSE parser, usage normalization, and 3x auto-retry with exponential backoff.
 */
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { HttpClient } from '../network/httpClient';
import { NativeStreamClient } from '../network/nativeStreamClient';
import { sanitizeLog } from '../security/secureStorage';
import { fetchNvidiaCatalog, sortNvidiaModels } from './nvidiaModelCatalog';

export const DEFAULT_NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_NVIDIA_MODEL = 'nvidia/llama-3.1-nemotron-120b-instruct';

export const CURATED_NVIDIA_MODELS = [
  { id: 'nvidia/llama-3.1-nemotron-120b-instruct', name: 'Llama 3.1 Nemotron 120B Instruct', vendor: 'NVIDIA' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B Instruct', vendor: 'NVIDIA' },
  { id: 'nvidia/nemotron-4-340b-instruct', name: 'Nemotron-4 340B Instruct', vendor: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', name: 'Nemotron 3 Ultra 550B Reasoning', vendor: 'NVIDIA' },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B Reasoning', vendor: 'OpenAI' },
  { id: 'minimaxai/minimax-m3', name: 'MiniMax M3', vendor: 'MiniMax' },
  { id: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', vendor: 'DeepSeek' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', vendor: 'Meta' },
  { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct', vendor: 'Meta' },
  { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', vendor: 'Meta' },
  { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', vendor: 'Meta' },
  { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', vendor: 'Alibaba' },
  { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2', vendor: 'Mistral' }
];

export class NvidiaNimProvider extends OpenAICompatibleProvider {
  constructor(config = {}) {
    super({
      id: 'nvidia',
      name: 'NVIDIA NIM',
      baseUrl: config.baseUrl || DEFAULT_NVIDIA_ENDPOINT,
      apiKey: config.apiKey || '',
      defaultModel: config.defaultModel || DEFAULT_NVIDIA_MODEL,
      ...config
    });
  }

  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: '請先在設定中輸入 NVIDIA API Key' };
    }
    try {
      const res = await HttpClient.request({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 12000
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

  /**
   * 網頁資料取得 → 解析 → 過濾 → 正規化 → 顯示可用模型
   */
  async listModels() {
    try {
      const catalog = await fetchNvidiaCatalog(this.apiKey);
      if (catalog && catalog.length > 0) {
        return catalog;
      }
    } catch (err) {
      console.warn('[NvidiaNimProvider listModels failed, using curated fallback]:', sanitizeLog(err.message));
    }
    return CURATED_NVIDIA_MODELS;
  }

  getToolCallingCapability(modelId) {
    if (!modelId) return 'unsupported';
    if (this.toolCapabilities.has(modelId)) {
      return this.toolCapabilities.get(modelId);
    }
    const lower = modelId.toLowerCase();
    if (
      lower.includes('meta/llama-3.1') ||
      lower.includes('meta/llama-3.3') ||
      lower.includes('mistralai/mixtral') ||
      lower.includes('mistralai/mistral-large') ||
      lower.includes('qwen/qwen2.5') ||
      lower.includes('openai/gpt-oss')
    ) {
      return 'supported';
    }
    if (
      lower.includes('embed') || lower.includes('rerank') ||
      lower.includes('guard') || lower.includes('reward') ||
      lower.includes('whisper') || lower.includes('tts')
    ) {
      return 'unsupported';
    }
    return 'unknown';
  }

  async *chatStream({ model, messages, temperature = 0.7, max_tokens = 8192, signal, tools = null }) {
    if (!this.apiKey) {
      yield { type: 'error', delta: '請先在設定中填寫 NVIDIA API Key (nvapi-...)' };
      return;
    }

    const targetModel = model || DEFAULT_NVIDIA_MODEL;
    let activeTools = (tools && tools.length > 0 && this.supportsToolCalling(targetModel)) ? tools : null;

    const buildPayload = (includeTools, includeUsage) => ({
      model: targetModel,
      messages,
      temperature,
      max_tokens,
      stream: true,
      ...(includeTools && activeTools ? { tools: activeTools, tool_choice: 'auto' } : {}),
      ...(includeUsage && this.supportsStreamOptions ? { stream_options: { include_usage: true } } : {})
    });

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.customHeaders
    };

    const url = `${this.baseUrl}/chat/completions`;
    const MAX_RETRIES = 3;
    let retryCount = 0;

    const executeStream = async function* (payload) {
      // 1. Android Native Streaming Path
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

      // 2. Standard Web Fetch Stream Fallback
      const response = await HttpClient.streamFetch(url, {
        headers,
        body: payload,
        signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`NVIDIA API 錯誤 (HTTP ${response.status}): ${sanitizeLog(errorText)}`);
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

    while (true) {
      try {
        const payload = buildPayload(Boolean(activeTools), true);
        for await (const chunk of executeStream(payload)) {
          yield chunk;
        }
        return;
      } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) {
          yield { type: 'done', delta: '' };
          return;
        }

        const isTemporary = err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504;
        if (isTemporary && retryCount < MAX_RETRIES) {
          retryCount++;
          const backoffMs = 1000 * Math.pow(2, retryCount - 1);
          yield {
            type: 'chunk',
            reasoning: `\n[暫時性 HTTP ${err.status || '網路'} 錯誤 - 正在進行第 ${retryCount}/${MAX_RETRIES} 次自動重試 (${backoffMs / 1000}s)...]\n`
          };
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        // Capability Fallback check for tools or stream_options
        const errMsg = (err.message || '').toLowerCase();
        const isToolError = activeTools && (errMsg.includes('tool') || errMsg.includes('function') || errMsg.includes('extra') || err.status === 400);
        const isStreamOptionError = this.supportsStreamOptions && (errMsg.includes('stream_options') || err.status === 400);

        if (isToolError || isStreamOptionError) {
          if (isToolError) {
            this.setToolCallingCapability(targetModel, 'unsupported');
            activeTools = null;
          }
          if (isStreamOptionError) {
            this.supportsStreamOptions = false;
          }

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
        return;
      }
    }
  }
}
