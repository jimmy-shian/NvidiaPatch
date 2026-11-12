import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
const path = require('path');
const fs = require('fs');
const { initDatabase, closeDatabase, apiKeys, settings } = require('../../database/database');
const { sendSingleRequest } = require('../../gateway/chat/upstream/sendSingleRequest');
const { createChatContext } = require('../../gateway/chat/context/chatContext');

const TEST_DB = path.join(__dirname, 'upstream-test.db');

describe('Upstream Request & Dispatch Mock Tests', () => {
  let originalFetch;

  beforeAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDatabase(TEST_DB);
    settings.save({ KEY_CONCURRENCY_DELAY_MS: 0, REQUEST_TIMEOUT_MS: 5000 });
    originalFetch = global.fetch;

    // Seed test keys
    apiKeys.add('nvapi-upstream-key-valid-1');
    apiKeys.add('nvapi-upstream-key-429-2');
  });

  afterAll(() => {
    global.fetch = originalFetch;
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  const createMockRes = () => ({
    statusCode: 200,
    once: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    setHeader: vi.fn()
  });

  it('should handle successful 200 response from NVIDIA upstream', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({
        id: 'chatcmpl-mock-1',
        choices: [{ message: { role: 'assistant', content: 'Hello from mock NVIDIA!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      })
    });

    const mockReq = { body: { model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] } };
    const mockRes = createMockRes();
    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'meta/llama-3.1-8b-instruct' },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: mockReq.body
    });

    expect(result.success).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.statusCode).toBe(200);
  });

  it('should mark key cooldown on 429 rate limit error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: { message: 'Rate limit exceeded' } })
    });

    const mockReq = { body: { model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] } };
    const mockRes = createMockRes();
    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'meta/llama-3.1-8b-instruct' },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: mockReq.body
    });

    expect(result.success).toBe(false);
    expect(result.retryScope).toBe('key');
    expect(result.statusCode).toBe(429);
  });

  it('should treat 503 server error as a model-level failure that switches to the next model', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: { message: 'Service Unavailable / Overloaded' } })
    });

    const mockReq = { body: { model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] } };
    const mockRes = createMockRes();
    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'meta/llama-3.1-70b-instruct' },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: mockReq.body
    });

    expect(result.success).toBe(false);
    expect(result.retryScope).toBe('model');
    // 5xx 屬 server 端問題 → 立即切換下一個模型，而非重試同一模型
    expect(result.shouldFallbackModel).toBe(true);
    expect(result.shouldRetrySameModel).toBeUndefined();
    expect(result.isTransient).toBeUndefined();
    expect(result.statusCode).toBe(503);
  });

  it('should still fall back to the next model on permanent 404 model-not-found error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: { message: 'Model not found' } })
    });

    const mockReq = { body: { model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] } };
    const mockRes = createMockRes();
    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'meta/llama-3.1-70b-instruct' },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: mockReq.body
    });

    expect(result.success).toBe(false);
    expect(result.retryScope).toBe('model');
    expect(result.shouldFallbackModel).toBe(true);
    expect(result.isTransient).toBeUndefined();
    expect(result.statusCode).toBe(404);
  });

  it('should forward multimodal image payload (image_url & text parts) intact', async () => {
    let capturedBody = null;
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          id: 'chatcmpl-vision-1',
          choices: [{ message: { role: 'assistant', content: 'I see an example image.' } }]
        })
      };
    });

    const multimodalPayload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg'
              }
            }
          ]
        }
      ],
      model: 'moonshotai/kimi-k3',
      max_tokens: 16384,
      seed: 0,
      stream: false,
      temperature: 0.7,
      reasoning_effort: 'max'
    };

    const { sanitizeChatCompletionBody } = require('../../gateway/utils/sanitize');
    const sanitized = sanitizeChatCompletionBody(multimodalPayload);

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: multimodalPayload },
      res: mockRes,
      originalBody: multimodalPayload,
      // 自訂端點（LM Studio）不做 NIM 參數過濾 / GLM 轉換 → 原始參數完整透傳
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0, NVIDIA_API_URL: 'http://localhost:1234/v1' }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'moonshotai/kimi-k3' },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: sanitized
    });

    expect(result.success).toBe(true);
    expect(capturedBody).toBeDefined();
    expect(capturedBody.model).toBe('moonshotai/kimi-k3');
    expect(capturedBody.max_tokens).toBe(16384);
    expect(capturedBody.seed).toBe(0);
    expect(capturedBody.reasoning_effort).toBe('max');
    expect(capturedBody.temperature).toBe(0.7);

    // Verify messages contain the image_url part intact
    const userMsg = capturedBody.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0].type).toBe('text');
    expect(userMsg.content[0].text).toBe('What is in this image?');
    expect(userMsg.content[1].type).toBe('image_url');
    expect(userMsg.content[1].image_url.url).toBe('https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg');
  });

  it('should not mark streaming tool_calls response as empty response', async () => {
    const { validateSuccessfulResponse } = require('../../gateway/chat/upstream/responseValidator');
    const { buildSafeSsePayload } = require('../../gateway/chat/response/ssePayloadBuilder');

    const sseChunks = [
      'data: {"id":"chatcmpl-tool-1","object":"chat.completion.chunk","created":123,"model":"moonshotai/kimi-k3","choices":[{"index":0,"delta":{"role":"assistant","content":null},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-tool-1","object":"chat.completion.chunk","created":123,"model":"moonshotai/kimi-k3","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"read_file","arguments":"{\\"path\\": \\"test.txt\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-tool-1","object":"chat.completion.chunk","created":123,"model":"moonshotai/kimi-k3","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: { model: 'moonshotai/kimi-k3', stream: true } },
      res: mockRes,
      originalBody: { model: 'moonshotai/kimi-k3', stream: true },
      activeConfig: { STREAM_READ_TIMEOUT_MS: 5000, ENABLE_CONTENT_VALIDATION: true }
    });

    const result = await validateSuccessfulResponse({
      context,
      model: { model_id: 'moonshotai/kimi-k3' },
      selectedKey: { id: 1 },
      result: { response: { body: stream } }
    });

    expect(result.success).toBe(true);
    expect(result.sseLines.length).toBeGreaterThan(0);

    const safePayload = buildSafeSsePayload({
      requestId: 'test-tool-req',
      sseLines: result.sseLines,
      clientModelId: 'moonshotai/kimi-k3'
    });

    expect(safePayload).toContain('tool_calls');
    expect(safePayload).toContain('call_abc');
    expect(safePayload).toContain('[DONE]');
  });

  it('should validate streaming reasoning_content response properly', async () => {
    const { validateSuccessfulResponse } = require('../../gateway/chat/upstream/responseValidator');

    const sseChunks = [
      'data: {"id":"chatcmpl-reason-1","object":"chat.completion.chunk","created":123,"model":"moonshotai/kimi-k3","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Let me think through this..."},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-reason-1","object":"chat.completion.chunk","created":123,"model":"moonshotai/kimi-k3","choices":[{"index":0,"delta":{"content":"The answer is 42."},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: { model: 'moonshotai/kimi-k3', stream: true } },
      res: mockRes,
      originalBody: { model: 'moonshotai/kimi-k3', stream: true },
      activeConfig: { STREAM_READ_TIMEOUT_MS: 5000, ENABLE_CONTENT_VALIDATION: true }
    });

    const result = await validateSuccessfulResponse({
      context,
      model: { model_id: 'moonshotai/kimi-k3' },
      selectedKey: { id: 1 },
      result: { response: { body: stream } }
    });

    expect(result.success).toBe(true);
    expect(result.streamContent).toContain('Let me think through this...');
    expect(result.streamContent).toContain('The answer is 42.');
  });

  it('should auto-reset cooldown restriction when all models are in cooldown to prevent deadlock', async () => {
    const { dispatchRequest } = require('../../gateway/chat/dispatch/dispatchRequest');
    const { markModelFailureCooldown, isModelInFailureCooldown } = require('../../gateway/cooldown/modelCooldown');

    const testModelId = 'moonshotai/kimi-k3';
    markModelFailureCooldown(testModelId, 'Simulated prior failure');
    expect(isModelInFailureCooldown(testModelId)).toBe(true);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({
        id: 'chatcmpl-recovered-1',
        choices: [{ message: { role: 'assistant', content: 'Recovered successfully!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      })
    });

    const mockReq = { body: { model: testModelId, stream: false, messages: [{ role: 'user', content: 'hello' }] } };
    const mockRes = createMockRes();
    mockRes.json = vi.fn();
    mockRes.status = vi.fn().mockReturnValue(mockRes);

    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: {
        REQUEST_TIMEOUT_MS: 5000,
        KEY_CONCURRENCY_DELAY_MS: 0,
        MAX_ROUNDS_PER_MODEL: 1,
        MAX_EMPTY_RESPONSE_RETRIES: 1,
        ENABLE_CONTENT_VALIDATION: true
      }
    });

    await dispatchRequest({
      context,
      configuredModels: [{ model_id: testModelId, priority: 1 }],
      sanitizedBody: mockReq.body
    });

    // Should have succeeded and called res.json with success, rather than returning 503 deadlock
    expect(mockRes.json).toHaveBeenCalled();
  });

  it('should automatically normalize hyphenated model IDs like z-ai/glm-5-3-flash to official dot version in upstream payload', async () => {
    let capturedBody = null;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      capturedBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          id: 'chatcmpl-mock-glm',
          choices: [{ message: { role: 'assistant', content: 'GLM response' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
        })
      });
    });

    const mockReq = { body: { model: 'z-ai/glm-5-3-flash', messages: [{ role: 'user', content: 'test' }] } };
    const mockRes = createMockRes();
    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'z-ai/glm-5-3-flash', priority: 1 },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: mockReq.body
    });

    expect(result.success).toBe(true);
    expect(capturedBody).not.toBeNull();
    // Verify that the model ID was transformed from hyphen to dot format before sending to upstream
    expect(capturedBody.model).toBe('z-ai/glm-5.3-flash');
  });

  it('should switch to the next model on upstream network/connection error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const mockReq = { body: { model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] } };
    const mockRes = createMockRes();
    const context = createChatContext({
      req: mockReq,
      res: mockRes,
      originalBody: mockReq.body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'meta/llama-3.1-70b-instruct' },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: mockReq.body
    });

    expect(result.success).toBe(false);
    expect(result.retryScope).toBe('model');
    // 網路連線異常屬 server 端問題 → 立即切換下一個模型
    expect(result.shouldFallbackModel).toBe(true);
    expect(result.isTransient).toBeUndefined();
  });

  it('should strip NVIDIA NIM unsupported parameters when nvidiaEndpoint option is enabled', () => {
    const { sanitizeChatCompletionBody } = require('../../gateway/utils/sanitize');

    const payload = {
      model: 'z-ai/glm-5.3-flash',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      top_p: 0.9,
      max_tokens: 1024,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      logit_bias: { '123': 1 },
      logprobs: true,
      top_logprobs: 5,
      seed: 42,
      stop: ['END'],
      stream_options: { include_usage: true },
      reasoning_effort: 'high',
      ignore_eos: false
    };

    const sanitized = sanitizeChatCompletionBody(payload, { nvidiaEndpoint: true });
    expect(sanitized.temperature).toBe(0.5);
    expect(sanitized.top_p).toBe(0.9);
    expect(sanitized.max_tokens).toBe(1024);
    for (const key of ['frequency_penalty', 'presence_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'seed', 'stop', 'stream_options', 'ignore_eos']) {
      expect(sanitized[key]).toBeUndefined();
    }
    // reasoning_effort 保留到 sendSingleRequest 依模型轉換或移除
    expect(sanitized.reasoning_effort).toBe('high');

    // 自訂端點（未傳入 nvidiaEndpoint）不做過濾，維持 OpenAI 規格透傳
    const untouched = sanitizeChatCompletionBody(payload);
    expect(untouched.seed).toBe(42);
    expect(untouched.reasoning_effort).toBe('high');
    expect(untouched.ignore_eos).toBe(false);
  });

  it('should convert GLM reasoning params to chat_template_kwargs and drop reasoning_effort for other models', () => {
    const { applyGlmReasoningConversion } = require('../../gateway/utils/sanitize');

    const glmHigh = applyGlmReasoningConversion({ reasoning_effort: 'high' }, 'z-ai/glm-5.3-flash');
    expect(glmHigh.reasoning_effort).toBeUndefined();
    expect(glmHigh.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });

    const glmNone = applyGlmReasoningConversion({ reasoning_effort: 'none' }, 'z-ai/glm-5.3-flash');
    expect(glmNone.chat_template_kwargs.enable_thinking).toBe(false);

    const glmMinimal = applyGlmReasoningConversion({ reasoning_effort: 'minimal' }, 'thudm/glm-4-9b-chat');
    expect(glmMinimal.chat_template_kwargs.enable_thinking).toBe(false);

    const nonGlm = applyGlmReasoningConversion({ reasoning_effort: 'high' }, 'moonshotai/kimi-k3');
    expect(nonGlm.reasoning_effort).toBeUndefined();
    expect(nonGlm.chat_template_kwargs).toBeUndefined();

    // 已存在的 chat_template_kwargs 其他欄位應保留，僅覆寫 enable_thinking / clear_thinking
    const merged = applyGlmReasoningConversion(
      { reasoning_effort: 'high', chat_template_kwargs: { enable_thinking: true, threshold: 0.5 } },
      'z-ai/glm-5.3-flash'
    );
    expect(merged.chat_template_kwargs).toEqual({ enable_thinking: true, threshold: 0.5, clear_thinking: false });

    // 沒有 reasoning_effort 時不注入任何欄位
    expect(applyGlmReasoningConversion({ temperature: 1 }, 'z-ai/glm-5.3-flash').chat_template_kwargs).toBeUndefined();
  });

  it('should forward GLM chat_template_kwargs and strip unsupported params for NVIDIA endpoint', async () => {
    let capturedBody = null;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      capturedBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          id: 'chatcmpl-mock-glm-conv',
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
        })
      });
    });

    const body = {
      model: 'z-ai/glm-5-3-flash',
      messages: [{ role: 'user', content: 'test' }],
      reasoning_effort: 'high',
      seed: 7
    };
    const { sanitizeChatCompletionBody } = require('../../gateway/utils/sanitize');
    const sanitized = sanitizeChatCompletionBody(body, { nvidiaEndpoint: true });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body },
      res: mockRes,
      originalBody: body,
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
    });

    const keys = apiKeys.getActiveKeys();
    const result = await sendSingleRequest({
      context,
      model: { model_id: 'z-ai/glm-5-3-flash', priority: 1 },
      key: keys[0],
      keyIndex: 0,
      availableKeys: keys,
      sanitizedBody: sanitized
    });

    expect(result.success).toBe(true);
    expect(capturedBody.seed).toBeUndefined();
    expect(capturedBody.reasoning_effort).toBeUndefined();
    expect(capturedBody.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
  });

  it('should retry the same model on stream read timeout after the first chunk', async () => {
    const { validateSuccessfulResponse } = require('../../gateway/chat/upstream/responseValidator');

    // 送出第一個 chunk 之後完全靜默（模擬上游節點中途過載）
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"chatcmpl-stall-1","choices":[{"index":0,"delta":{},"finish_reason":null}]}\n\n'));
      }
    });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: { model: 'z-ai/glm-5.3-flash', stream: true } },
      res: mockRes,
      originalBody: { model: 'z-ai/glm-5.3-flash', stream: true },
      activeConfig: { STREAM_READ_TIMEOUT_MS: 150, FIRST_TOKEN_TIMEOUT_MS: 5000, ENABLE_CONTENT_VALIDATION: true }
    });

    const result = await validateSuccessfulResponse({
      context,
      model: { model_id: 'z-ai/glm-5.3-flash' },
      selectedKey: { id: 1 },
      result: { response: { body: stream } }
    });

    expect(result.success).toBe(false);
    // 串流讀取逾時 → 重試同一模型
    expect(result.transientFailure).toBe(true);
    expect(result.forceRetrySameModel).toBe(true);
    expect(result.forceFallbackModel).toBeUndefined();
    expect(result.errorText).toContain('讀取逾時');
  });

  it('should resend the same model on first token timeout when no chunk arrives', async () => {
    const { validateSuccessfulResponse } = require('../../gateway/chat/upstream/responseValidator');

    // 建立 HTTP 200 連線但永不送出任何 Chunk（模擬上游 351s/608s 卡死）
    const stream = new ReadableStream({
      start() {
        // 永不 enqueue、永不 close
      }
    });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: { model: 'z-ai/glm-5.3-flash', stream: true } },
      res: mockRes,
      originalBody: { model: 'z-ai/glm-5.3-flash', stream: true },
      activeConfig: { STREAM_READ_TIMEOUT_MS: 5000, FIRST_TOKEN_TIMEOUT_MS: 150, ENABLE_CONTENT_VALIDATION: true }
    });

    const result = await validateSuccessfulResponse({
      context,
      model: { model_id: 'z-ai/glm-5.3-flash' },
      selectedKey: { id: 1 },
      result: { response: { body: stream } }
    });

    expect(result.success).toBe(false);
    // 首 Token 逾時 → 重發同一模型（總時長不受限，僅首個 chunk 等待有上限）
    expect(result.transientFailure).toBe(true);
    expect(result.firstTokenTimeout).toBe(true);
    expect(result.forceRetrySameModel).toBe(true);
    expect(result.forceFallbackModel).toBeUndefined();
    expect(result.errorText).toContain('首 Token 逾時');
  });

  it('should classify transient vs permanent upstream error content correctly', () => {
    const { isTransientUpstreamError } = require('../../gateway/engine/upstreamErrorDetector');

    // 暫時性（節點故障）→ 應重試同一模型
    expect(isTransientUpstreamError('Internal server error')).toBe(true);
    expect(isTransientUpstreamError('Service Unavailable / Overloaded')).toBe(true);
    expect(isTransientUpstreamError('502 Bad Gateway')).toBe(true);
    expect(isTransientUpstreamError('Model is temporarily overloaded')).toBe(true);

    // 永久性（請求不合法 / 模型不存在）→ 應立即切換下一個模型
    expect(isTransientUpstreamError('At most 8 image(s) may be provided in one prompt')).toBe(false);
    expect(isTransientUpstreamError('Maximum context length exceeded')).toBe(false);
    expect(isTransientUpstreamError('Model not found')).toBe(false);
    expect(isTransientUpstreamError('Unsupported parameter: response_format')).toBe(false);
    expect(isTransientUpstreamError('')).toBe(false);
  });

  it('should retry the same model on HTTP 200 fake success with transient server error', async () => {
    const { validateSuccessfulResponse } = require('../../gateway/chat/upstream/responseValidator');

    const sseChunks = [
      'data: {"id":"chatcmpl-fake-1","object":"chat.completion.chunk","created":123,"model":"z-ai/glm-5.3-flash","choices":[{"index":0,"delta":{"content":"Internal server error"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: { model: 'z-ai/glm-5.3-flash', stream: true } },
      res: mockRes,
      originalBody: { model: 'z-ai/glm-5.3-flash', stream: true },
      activeConfig: { STREAM_READ_TIMEOUT_MS: 5000, ENABLE_CONTENT_VALIDATION: true }
    });

    const result = await validateSuccessfulResponse({
      context,
      model: { model_id: 'z-ai/glm-5.3-flash' },
      selectedKey: { id: 1 },
      result: { response: { body: stream } }
    });

    expect(result.success).toBe(false);
    expect(result.transientFailure).toBe(true);
    expect(result.forceRetrySameModel).toBe(true);
    expect(result.forceFallbackModel).toBeUndefined();
  });

  it('should fall back to the next model on HTTP 200 fake success with permanent request error', async () => {
    const { validateSuccessfulResponse } = require('../../gateway/chat/upstream/responseValidator');

    const sseChunks = [
      'data: {"id":"chatcmpl-fake-2","error":{"message":"At most 8 image(s) may be provided in one prompt"},"choices":[{"index":0,"delta":{"content":"At most 8 image(s) may be provided in one prompt"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });

    const mockRes = createMockRes();
    const context = createChatContext({
      req: { body: { model: 'minimaxai/minimax-m3.1-flash', stream: true } },
      res: mockRes,
      originalBody: { model: 'minimaxai/minimax-m3.1-flash', stream: true },
      activeConfig: { STREAM_READ_TIMEOUT_MS: 5000, ENABLE_CONTENT_VALIDATION: true }
    });

    const result = await validateSuccessfulResponse({
      context,
      model: { model_id: 'minimaxai/minimax-m3.1-flash' },
      selectedKey: { id: 1 },
      result: { response: { body: stream } }
    });

    expect(result.success).toBe(false);
    expect(result.forceFallbackModel).toBe(true);
    expect(result.transientFailure).toBeUndefined();
  });

  it('should default MAX_ROUNDS_PER_MODEL to 10 when the setting is missing or invalid', () => {
    const { resolveRetryLimits } = require('../../gateway/chat/context/chatContext');

    expect(resolveRetryLimits({}).MAX_ROUNDS_PER_MODEL).toBe(10);
    expect(resolveRetryLimits({ MAX_ROUNDS_PER_MODEL: 0 }).MAX_ROUNDS_PER_MODEL).toBe(10);
    expect(resolveRetryLimits({ MAX_ROUNDS_PER_MODEL: 99 }).MAX_ROUNDS_PER_MODEL).toBe(10);
    expect(resolveRetryLimits({ MAX_ROUNDS_PER_MODEL: 4 }).MAX_ROUNDS_PER_MODEL).toBe(4);
    expect(resolveRetryLimits({}).MAX_EMPTY_RESPONSE_RETRIES).toBe(3);
  });
});
