import { describe, it, expect, vi } from 'vitest';
import { BingHtmlProvider } from '../search/BingHtmlProvider';
import { DuckDuckGoHtmlProvider } from '../search/DuckDuckGoHtmlProvider';
import { MojeekHtmlProvider } from '../search/MojeekHtmlProvider';
import { WikipediaSearchProvider } from '../search/WikipediaSearchProvider';
import { normalizeSearchResults } from '../search/searchNormalizer';
import { SearchProviderRegistry } from '../search/providerRegistry';
import { HttpClient } from '../../network/httpClient';

const MOCK_BING_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ol id="b_results">
    <li class="b_algo">
      <h2>
        <a href="https://www.bing.com/ck/a?!&&p=123&u=a1aHR0cHM6Ly9jYWxlbmRhci50YWxsbGthaS5jb20vVG9kYXk&ntb=1">台灣放假行事曆</a>
      </h2>
      <div class="b_caption">
        <p>提供今日即時公假與停班停課資訊查詢。</p>
      </div>
    </li>
  </ol>
</body>
</html>
`;

const MOCK_DDG_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnvidianews.nvidia.com%2Fnews%2Fblackwell&rut=...">NVIDIA Blackwell Platform News</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnvidianews.nvidia.com%2Fnews%2Fblackwell&rut=...">
      NVIDIA today announced full production of Blackwell architecture GPUs.
    </a>
  </div>
</body>
</html>
`;

const MOCK_MOJEEK_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ul class="results-standard">
    <li>
      <a class="title" href="https://deepseek.com/blog/v4-announcement">DeepSeek-V4 Release Announcement</a>
      <p class="snippet">DeepSeek announces V4 model architecture with enhanced reasoning capabilities.</p>
    </li>
  </ul>
</body>
</html>
`;

describe('Search Providers & Normalizer', () => {
  it('BingHtmlProvider decodes u=a1 base64 redirect URLs and extracts b_algo items', () => {
    const provider = new BingHtmlProvider();
    const results = provider.parseHtml(MOCK_BING_HTML);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('台灣放假行事曆');
    expect(results[0].url).toBe('https://calendar.talllkai.com/Today');
    expect(results[0].snippet).toContain('提供今日即時公假');
    expect(results[0].source).toBe('bing');
  });

  it('BingHtmlProvider safely decodes base64url characters with dashes and underscores', () => {
    const provider = new BingHtmlProvider();
    const testUrl = 'https://www.bing.com/ck/a?!&&p=123&u=a1aHR0cHM6Ly96aC53aWtpcGVkaWEub3JnL3poLXR3LyVFNyVCRSU4RSVFNSU5QiVCRA&ntb=1';
    const decoded = provider.decodeBingUrl(testUrl);
    expect(decoded).toBe('https://zh.wikipedia.org/zh-tw/%E7%BE%8E%E5%9B%BD');
  });

  it('DuckDuckGoHtmlProvider resolves uddg redirects and extracts search items', () => {
    const provider = new DuckDuckGoHtmlProvider();
    const results = provider.parseHtml(MOCK_DDG_HTML);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('NVIDIA Blackwell Platform News');
    expect(results[0].url).toBe('https://nvidianews.nvidia.com/news/blackwell');
    expect(results[0].snippet).toContain('Blackwell architecture GPUs');
    expect(results[0].source).toBe('duckduckgo');
  });

  it('MojeekHtmlProvider parses standard web SERP elements', () => {
    const provider = new MojeekHtmlProvider();
    const results = provider.parseHtml(MOCK_MOJEEK_HTML);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('DeepSeek-V4 Release Announcement');
    expect(results[0].url).toBe('https://deepseek.com/blog/v4-announcement');
    expect(results[0].snippet).toContain('DeepSeek announces V4');
    expect(results[0].source).toBe('mojeek');
  });

  it('searchNormalizer deduplicates and limits results per domain', () => {
    const rawResults = [
      { title: 'Doc 1', url: 'https://github.com/org/repo1', snippet: 'A', source: 'web' },
      { title: 'Doc 2', url: 'https://github.com/org/repo2', snippet: 'B', source: 'web' },
      { title: 'Doc 3', url: 'https://github.com/org/repo3', snippet: 'C', source: 'web' },
      { title: 'Doc 4', url: 'https://nvidia.com/news', snippet: 'D', source: 'web' }
    ];

    const normalized = normalizeSearchResults(rawResults, 'general query', { maxPerDomain: 2, maxResults: 5 });
    expect(normalized).toHaveLength(3);
    const githubLinks = normalized.filter(r => r.url.includes('github.com'));
    expect(githubLinks).toHaveLength(2);
    expect(normalized[2].url).toBe('https://nvidia.com/news');
  });

  it('SearchProviderRegistry falls back across providers when failures occur', async () => {
    const registry = new SearchProviderRegistry();

    // Mock HttpClient: Bing fails, DDG fails, Mojeek succeeds
    vi.spyOn(HttpClient, 'request')
      .mockResolvedValueOnce({ ok: false, status: 500, data: 'Error' }) // Bing fails
      .mockResolvedValueOnce({ ok: false, status: 403, data: 'Access Denied' }) // DDG fails
      .mockResolvedValueOnce({ ok: true, status: 200, data: MOCK_MOJEEK_HTML }); // Mojeek succeeds

    const results = await registry.search('DeepSeek new models');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('mojeek');
    expect(results[0].url).toBe('https://deepseek.com/blog/v4-announcement');
  });

  it('WikipediaSearchProvider searches Wikipedia API and returns formatted articles', async () => {
    const provider = new WikipediaSearchProvider();

    vi.spyOn(HttpClient, 'request').mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        query: {
          search: [
            { title: '美國總統', snippet: '<b>美國總統</b>是美利堅合眾國的國家元首...' }
          ]
        }
      }
    });

    const results = await provider.search('美國總統');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('美國總統');
    expect(results[0].url).toContain('zh.wikipedia.org/wiki/%E7%BE%8E%E5%9C%8B%E7%B8%BD%E7%B5%B1');
    expect(results[0].snippet).toContain('美國總統是美利堅合眾國');
    expect(results[0].source).toBe('wikipedia');
  });
});
