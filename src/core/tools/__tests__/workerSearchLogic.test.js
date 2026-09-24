import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../../../cloudflare-search-worker/src/index.js';

describe('Cloudflare Search Worker Local Logic', () => {
  const env = { API_KEY: 'test-secret-key-123' };
  const ctx = {
    waitUntil: vi.fn()
  };

  it('/health returns ok status without authentication', async () => {
    const req = new Request('https://worker.test/health', { method: 'GET' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.version).toBe('1.0.0');
  });

  it('rejects /search without valid API_KEY with 401', async () => {
    const req = new Request('https://worker.test/search?q=test', { method: 'GET' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.errorKind).toBe('unauthorized');
  });

  it('rejects empty query on /search with 400', async () => {
    const req = new Request('https://worker.test/search?q=', {
      method: 'GET',
      headers: { 'X-Api-Key': 'test-secret-key-123' }
    });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errorKind).toBe('invalid_parameter');
  });

  it('blocks SSRF on /fetch for localhost or non-http protocols', async () => {
    const forbiddenUrls = [
      'http://localhost:8080/secret',
      'http://127.0.0.1:3000',
      'file:///etc/passwd',
      'ftp://ftp.example.com'
    ];

    for (const badUrl of forbiddenUrls) {
      const req = new Request(`https://worker.test/fetch?url=${encodeURIComponent(badUrl)}`, {
        method: 'GET',
        headers: { 'X-Api-Key': 'test-secret-key-123' }
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.errorKind).toBe('invalid_url');
    }
  });

  it('handles CORS OPTIONS preflight request', async () => {
    const req = new Request('https://worker.test/search', { method: 'OPTIONS' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
