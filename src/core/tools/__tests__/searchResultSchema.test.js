import { describe, it, expect, vi } from 'vitest';
import { executeWebSearch } from '../webSearch';
import { defaultSearchRegistry } from '../search';
import { HttpClient } from '../../network/httpClient';

describe('Search Result Count & Schema Invariants', () => {
  it('strictly adheres to resultCount and pagesToReadCount schema', async () => {
    vi.spyOn(defaultSearchRegistry, 'search').mockResolvedValue([
      { title: 'Doc 1', url: 'https://site1.com/a', snippet: 'A', source: 'bing' },
      { title: 'Doc 2', url: 'https://site2.com/b', snippet: 'B', source: 'bing' },
      { title: 'Doc 3', url: 'https://site3.com/c', snippet: 'C', source: 'bing' },
      { title: 'Doc 4', url: 'https://site4.com/d', snippet: 'D', source: 'bing' },
      { title: 'Doc 5', url: 'https://site5.com/e', snippet: 'E', source: 'bing' }
    ]);

    vi.spyOn(HttpClient, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      data: '<html><head><title>Title</title></head><article><p>Content details of page.</p></article></html>'
    });

    const progressEvents = [];
    const res = await executeWebSearch(
      { query: 'NVIDIA RTX 5090', maxPagesToFetch: 3 },
      { onProgress: (p) => progressEvents.push(p) }
    );

    // Schema invariants
    expect(res.resultCount).toBe(5);
    expect(res.pagesToReadCount).toBe(3);
    expect(res.results).toHaveLength(5);
    expect(res.providersUsed).toContain('bing');

    // Progress events invariant
    const readEvent = progressEvents.find(p => p.phase === 'reading');
    expect(readEvent).toBeDefined();
    expect(readEvent.resultCount).toBe(5);
    expect(readEvent.pagesToReadCount).toBe(3);
  });

  it('preserves accumulated resultCount and does not reset to 0 upon relaxation retry', async () => {
    vi.spyOn(defaultSearchRegistry, 'search')
      .mockResolvedValueOnce([]) // Tier 1 returns 0
      .mockResolvedValueOnce([   // Tier 2 (relaxed) returns 4 results
        { title: 'NVIDIA 5090 News', url: 'https://nvidianews.com/1', snippet: 'A', source: 'duckduckgo' },
        { title: 'RTX 5090 Specs', url: 'https://tomshardware.com/2', snippet: 'B', source: 'duckduckgo' },
        { title: 'GeForce 5090', url: 'https://videocardz.com/3', snippet: 'C', source: 'duckduckgo' },
        { title: 'Architecture 5090', url: 'https://anandtech.com/4', snippet: 'D', source: 'duckduckgo' }
      ]);

    vi.spyOn(HttpClient, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      data: '<html><head><title>Title</title></head><article><p>Article content details.</p></article></html>'
    });

    const res = await executeWebSearch({ query: '請幫我查詢 NVIDIA RTX 5090 最新發布' });

    expect(res.resultCount).toBe(4);
    expect(res.results).toHaveLength(4);
    expect(res.isFallback).toBe(true);
  });
});
