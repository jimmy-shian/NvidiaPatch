/**
 * NvidiaNimProvider - NVIDIA NIM LLM Integration
 * Features full model catalog crawling, normalization, filtering, and 3x auto-retry streaming.
 */
import { ProviderAdapter } from './ProviderAdapter';
import { HttpClient } from '../network/httpClient';
import { sanitizeLog } from '../security/secureStorage';
import { fetchNvidiaCatalog, sortNvidiaModels } from './nvidiaModelCatalog';

export const DEFAULT_NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_NVIDIA_MODEL = 'nvidia/llama-3.1-nemotron-120b-instruct';

export const CURATED_NVIDIA_MODELS = [
  { id: 'nvidia/llama-3.1-nemotron-120b-instruct', name: 'Llama 3.1 Nemotron 120B Instruct', vendor: 'NVIDIA' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B Instruct', vendor: 'NVIDIA' },
  { id: 'nvidia/nemotron-4-340b-instruct', name: 'Nemotron-4 340B Instruct', vendor: 'NVIDIA' },
  { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1 (Reasoning)', vendor: 'DeepSeek' },
  { id: 'deepseek-ai/deepseek-v3', name: 'DeepSeek V3', vendor: 'DeepSeek' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', vendor: 'Meta' },
  { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct', vendor: 'Meta' },
  { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', vendor: 'Meta' },
  { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', vendor: 'Meta' },
  { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', vendor: 'Alibaba' },
  { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2', vendor: 'Mistral' }
];

export class NvidiaNimProvider extends ProviderAdapter {
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
   * 網頁資料取得 → 解析 → 過濾 → 正規化 → 顯示可用模型 (比照桌面應用程式邏輯)
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

  async *chatStream({ model, messages, temperature = 0.7, max_tokens = 4096, signal, tools = null }) {
    if (!this.apiKey) {
      yield { type: 'error', delta: '請先在設定中填寫 NVIDIA API Key (nvapi-...)' };
      return;
    }

    const targetModel = model || DEFAULT_NVIDIA_MODEL;

    const payload = {
      model: targetModel,
      messages,
      temperature,
      max_tokens,
      stream: true,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {})
    };

    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (true) {
      try {
        const response = await HttpClient.streamFetch(`${this.baseUrl}/chat/completions`, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            ...this.customHeaders
          },
          body: payload,
          signal
        });

        if (!response.ok) {
          const isTemporary = response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504;
          if (isTemporary && retryCount < MAX_RETRIES) {
            retryCount++;
            const backoffMs = 1000 * Math.pow(2, retryCount - 1);
            yield { type: 'thinking', delta: `\n[暫時性 HTTP ${response.status} 錯誤 - 正在進行第 ${retryCount}/${MAX_RETRIES} 次自動重試 (${backoffMs / 1000}s)...]\n` };
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }

          const errorText = await response.text();
          yield { type: 'error', delta: `NVIDIA API 錯誤 (HTTP ${response.status}): ${sanitizeLog(errorText)}` };
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
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') {
              yield { type: 'done', delta: '' };
              return;
            }

            try {
              const chunk = JSON.parse(dataStr);
              const choice = chunk.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (!delta) continue;

              // 1. Thinking / Reasoning delta (filter \uE000 delimiters)
              const reasoning = delta.reasoning_content || delta.reasoning;
              if (reasoning) {
                const cleanReasoning = typeof reasoning === 'string'
                  ? reasoning.replace(/\uE000+/g, '')
                  : reasoning;
                if (cleanReasoning) {
                  yield { type: 'thinking', delta: cleanReasoning };
                }
              }

              // 2. Regular content delta
              if (delta.content) {
                const cleanContent = typeof delta.content === 'string'
                  ? delta.content.replace(/\uE000+/g, '')
                  : delta.content;
                if (cleanContent) {
                  yield { type: 'content', delta: cleanContent };
                }
              }

              // 3. Tool calls delta
              if (delta.tool_calls) {
                yield { type: 'tool_call', delta: '', data: delta.tool_calls };
              }
            } catch (parseErr) {
              // Ignore single malformed chunk
            }
          }
        }

        yield { type: 'done', delta: '' };
        return;
      } catch (err) {
        if (err.name === 'AbortError') {
          yield { type: 'done', delta: '' };
          return;
        }
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          const backoffMs = 1000 * Math.pow(2, retryCount - 1);
          yield { type: 'thinking', delta: `\n[網路連線異常 - 正在進行第 ${retryCount}/${MAX_RETRIES} 次自動重試 (${backoffMs / 1000}s)...]\n` };
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        yield { type: 'error', delta: `連線失敗: ${sanitizeLog(err.message)}` };
        return;
      }
    }
  }

  supportsToolCalling(modelId) {
    if (!modelId) return false;
    const lower = modelId.toLowerCase();
    return lower.includes('meta/llama-3.1') ||
           lower.includes('meta/llama-3.3') ||
           lower.includes('mistralai/mixtral') ||
           lower.includes('qwen/qwen2.5');
  }
}
