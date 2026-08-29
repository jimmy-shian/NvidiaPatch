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

  it('should trigger model fallback on 503 server error', async () => {
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
    expect(result.shouldFallbackModel).toBe(true);
    expect(result.statusCode).toBe(503);
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
      activeConfig: { REQUEST_TIMEOUT_MS: 5000, KEY_CONCURRENCY_DELAY_MS: 0 }
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
});
