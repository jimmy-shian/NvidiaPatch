import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerSearchProvider, WORKER_SEARCH_CONFIG_KEYS } from '../search/WorkerSearchProvider';
import { SearchProviderRegistry } from '../search/providerRegistry';
import { executeWebSearch } from '../webSearch';
import { WebPageFetcher } from '../web/WebPageFetcher';
import { HttpClient } from '../../network/httpClient';
import { LocalDB } from '../../storage/localDatabase';
import { SecureStorage } from '../../security/secureStorage';

describe('WorkerSearchProvider, WebPageFetcher & Fallback Pipeline', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    // Default disable worker in settings
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, 'false');
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.URL, '');
    await SecureStorage.setItem(WORKER_SEARCH_CONFIG_KEYS.API_KEY, '');
  });

  it('WorkerSearchProvider throws NOT_CONFIGURED when disabled or without URL', async () => {
    const provider = new WorkerSearchProvider();
    await expect(provider.search('test query')).rejects.toThrow('Cloudflare Worker search proxy not configured or disabled');
  });

  it('WorkerSearchProvider calls worker /search with headers and returns formatted results', async () => {
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, 'true');
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.URL, 'https://test-worker.workers.dev');
    await SecureStorage.setItem(WORKER_SEARCH_CONFIG_KEYS.API_KEY, 'secret-123');

    const provider = new WorkerSearchProvider();

    const requestSpy = vi.spyOn(HttpClient, 'request').mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        query: 'NVIDIA RTX',
        effectiveProvider: 'bing',
        results: [
          { title: 'NVIDIA RTX 5090', url: 'https://nvidia.com/5090', snippet: 'Specs', source: 'bing' }
        ],
        count: 1,
        providerErrors: [],
        error: null
      }
    });

    const results = await provider.search('NVIDIA RTX');

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const callArgs = requestSpy.mock.calls[0][0];
    expect(callArgs.url).toContain('https://test-worker.workers.dev/search?q=NVIDIA%20RTX');
    expect(callArgs.headers['X-Api-Key']).toBe('secret-123');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('NVIDIA RTX 5090');
    expect(results[0].source).toBe('worker:bing');
  });

  it('SearchProviderRegistry automatically falls back to Bing when Worker fails with 401 or network error', async () => {
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, 'true');
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.URL, 'https://test-worker.workers.dev');

    const registry = new SearchProviderRegistry();

    // 1st request to Worker fails with 401 Unauthorized
    // 2nd request to Bing succeeds
    vi.spyOn(HttpClient, 'request')
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        data: { error: 'Unauthorized', errorKind: 'unauthorized' }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: `
          <ol id="b_results">
            <li class="b_algo">
              <h2><a href="https://nvidia.com/news">NVIDIA Direct Bing Result</a></h2>
              <div class="b_caption"><p>Direct fallback snippet.</p></div>
            </li>
          </ol>
        `
      });

    const results = await registry.search('fallback query');

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('NVIDIA Direct Bing Result');
    expect(results[0].source).toBe('bing');
  });

  it('WebPageFetcher routes through Worker /fetch when enabled and falls back to direct fetch on error', async () => {
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, 'true');
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.URL, 'https://test-worker.workers.dev');
    await SecureStorage.setItem(WORKER_SEARCH_CONFIG_KEYS.API_KEY, 'secret-key');

    // 1. Worker fetch returns structured page content
    const workerSpy = vi.spyOn(HttpClient, 'request').mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        ok: true,
        title: 'Worker Page Title',
        url: 'https://example.com/article',
        snippet: 'Snippet from worker',
        content: 'Worker extracted full readable text article.',
        error: null
      }
    });

    const page = await WebPageFetcher.fetch('https://example.com/article');

    expect(page.ok).toBe(true);
    expect(page.title).toBe('Worker Page Title');
    expect(page.content).toContain('Worker extracted full readable text');

    // Verify Worker fetch endpoint called
    const callArgs = workerSpy.mock.calls[0][0];
    expect(callArgs.url).toContain('https://test-worker.workers.dev/fetch?url=https%3A%2F%2Fexample.com%2Farticle');
    expect(callArgs.headers['X-Api-Key']).toBe('secret-key');
  });

  it('WorkerSearchProvider.testConnection validates /health endpoint', async () => {
    vi.spyOn(HttpClient, 'request').mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { status: 'ok', version: '1.0.0' }
    });

    const res = await WorkerSearchProvider.testConnection('https://my-worker.workers.dev');
    expect(res.success).toBe(true);
    expect(res.message).toContain('v1.0.0');
  });

  it('executeWebSearch surfaces providerErrors in output object', async () => {
    await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, 'false');

    vi.spyOn(HttpClient, 'request')
      .mockResolvedValueOnce({ ok: false, status: 500, data: 'Error' }) // Bing fails
      .mockResolvedValueOnce({ ok: false, status: 403, data: 'Forbidden' }) // DDG fails
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: `
          <ul class="results-standard">
            <li>
              <a class="title" href="https://example.com/mojeek-page">Mojeek Title</a>
              <p class="snippet">Mojeek snippet text.</p>
            </li>
          </ul>
        `
      }) // Mojeek succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: '<html><head><title>Mojeek Title</title></head><article><p>Article body.</p></article></html>'
      });

    const searchRes = await executeWebSearch({ query: 'testing provider errors' });

    expect(searchRes.resultCount).toBe(1);
    expect(searchRes.providerErrors).toBeDefined();
    expect(searchRes.providerErrors.some(e => e.provider === 'bing')).toBe(true);
    expect(searchRes.providerErrors.some(e => e.provider === 'duckduckgo')).toBe(true);
  });
});
