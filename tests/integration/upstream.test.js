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
});
