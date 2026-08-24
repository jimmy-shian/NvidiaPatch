import { describe, it, expect, vi } from 'vitest';
import { executeWebSearch, SEARCH_BUDGET_LIMITS } from '../webSearch';
import { defaultSearchRegistry } from '../search';
import { HttpClient } from '../../network/httpClient';

const MOCK_RELAXED_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ol id="b_results">
    <li class="b_algo">
      <h2><a href="https://nvidia.com/rtx5090">NVIDIA RTX 5090 Official Specs</a></h2>
      <div class="b_caption"><p>Next gen flagship GPU 2026 specs and architecture details.</p></div>
    </li>
  </ol>
</body>
</html>
`;

describe('Web Search Budgets, Progressive Relaxation & Ephemeral Flow', () => {
  it('defines clear safety limits', () => {
    expect(SEARCH_BUDGET_LIMITS.MAX_SEARCH_ATTEMPTS_PER_RUN).toBe(10);
    expect(SEARCH_BUDGET_LIMITS.MAX_PROVIDER_ATTEMPTS_PER_SEARCH).toBe(4);
    expect(SEARCH_BUDGET_LIMITS.MAX_PAGES_TO_FETCH).toBe(3);
  });

  it('performs progressive relaxation when Tier 1 search yields 0 results', async () => {
    const progressEvents = [];

    // Mock search registry: 1st call (raw query) returns 0 results, 2nd call (relaxed query) returns results
    const searchSpy = vi.spyOn(defaultSearchRegistry, 'search')
      .mockResolvedValueOnce([]) // Tier 1 fails
      .mockResolvedValueOnce([   // Tier 2 succeeds
        { title: 'NVIDIA RTX 5090 Official Specs', url: 'https://nvidia.com/rtx5090', snippet: 'Specs', source: 'bing' }
      ]);

    vi.spyOn(HttpClient, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      data: '<html><head><title>NVIDIA RTX 5090 Official Specs</title></head><article><p>NVIDIA RTX 5090 details released in 2026 with huge memory bandwidth.</p></article></html>'
    });

    const result = await executeWebSearch(
      { query: '請幫我查詢 NVIDIA RTX 5090 2026 的最新規格' },
      {
        onProgress: (p) => progressEvents.push(p)
      }
    );

    expect(result.count).toBe(1);
    expect(result.results[0].title).toBe('NVIDIA RTX 5090 Official Specs');
    expect(searchSpy).toHaveBeenCalledTimes(2);

    // Verify progress events
    const searchingEvent = progressEvents.find(p => p.phase === 'searching');
    const retryEvent = progressEvents.find(p => p.phase === 'retrying_query');
    expect(searchingEvent).toBeDefined();
    expect(retryEvent).toBeDefined();
    expect(retryEvent.relaxedQuery).toContain('NVIDIA RTX 5090 2026');
  });

  it('returns graceful fallback message when all search providers return empty results', async () => {
    vi.spyOn(defaultSearchRegistry, 'search').mockResolvedValue([]);

    const result = await executeWebSearch({ query: 'nonexistent_gibberish_term_xyz_123' });

    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.message).toContain('No relevant search results found');
    expect(result.tip).toBeDefined();
  });
});
