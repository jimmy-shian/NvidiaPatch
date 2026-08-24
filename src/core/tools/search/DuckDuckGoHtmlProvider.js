/**
 * DuckDuckGo HTML Search Provider
 * Scrapes DuckDuckGo's public HTML SERP without requiring JavaScript execution or API keys.
 */
import { SearchProvider } from './SearchProvider';
import { HttpClient } from '../../network/httpClient';
import { decodeHtmlEntities } from '../web/ContentExtractor';

export class DuckDuckGoHtmlProvider extends SearchProvider {
  constructor() {
    super('duckduckgo');
  }

  /**
   * Resolve DuckDuckGo uddg tracking redirect into destination URL
   */
  resolveDuckDuckGoUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';

    let url = rawUrl;
    if (url.includes('uddg=')) {
      const match = url.match(/uddg=([^&]+)/);
      if (match && match[1]) {
        try {
          url = decodeURIComponent(match[1]);
        } catch (_) {}
      }
    }

    if (url.startsWith('//')) {
      url = 'https:' + url;
    }

    if (url.startsWith('/l/?kh=') || url.startsWith('/l/?')) {
      const match = url.match(/uddg=([^&]+)/);
      if (match && match[1]) {
        try {
          url = decodeURIComponent(match[1]);
        } catch (_) {}
      }
    }

    return url.startsWith('http://') || url.startsWith('https://') ? url : '';
  }

  /**
   * Parse HTML SERP into structured results
   */
  parseHtml(html) {
    if (!html || typeof html !== 'string') return [];

    const results = [];
    const seenUrls = new Set();

    // 1. Split into result sections or match result blocks
    // In DDG HTML, results are delimited by <div class="result ..."> or <div class="web-result ...">
    const resultBlocks = html.split(/<div\b[^>]*class=["'][^"']*(?:results_links|web-result|result\b)[^"']*["'][^>]*>/i);

    // Skip preamble before first result
    for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
      const block = resultBlocks[i];

      // Extract Title: <a class="result__a" ...>Title</a> or <a class="result-link" ...>
      const titleMatch = block.match(/<a\b[^>]*class=["'][^"']*(?:result__a|result-link)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      // Extract Snippet: <a class="result__snippet" ...>Snippet</a> or <td class="result-snippet">...</td>
      const snippetMatch = block.match(/<a\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/<(?:td|div|p)\b[^>]*class=["'][^"']*(?:result-snippet|result__snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:td|div|p)>/i);

      if (titleMatch) {
        const rawHref = titleMatch[1];
        const rawTitle = titleMatch[2].replace(/<[^>]+>/g, '').trim();
        const resolvedUrl = this.resolveDuckDuckGoUrl(rawHref);

        if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
          seenUrls.add(resolvedUrl);
          const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

          results.push({
            title: decodeHtmlEntities(rawTitle || resolvedUrl),
            url: resolvedUrl,
            snippet: decodeHtmlEntities(rawSnippet),
            source: 'duckduckgo'
          });
        }
      }
    }

    // 2. Direct regex fallback if splitting didn't find items
    if (results.length === 0) {
      const directRegex = /<a\b[^>]*class=["'][^"']*(?:result__a|result__snippet)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = directRegex.exec(html)) !== null && results.length < 8) {
        const resolvedUrl = this.resolveDuckDuckGoUrl(match[1]);
        if (!resolvedUrl || seenUrls.has(resolvedUrl)) continue;
        seenUrls.add(resolvedUrl);
        const text = match[2].replace(/<[^>]+>/g, '').trim();

        results.push({
          title: decodeHtmlEntities(text || resolvedUrl),
          url: resolvedUrl,
          snippet: decodeHtmlEntities(text),
          source: 'duckduckgo'
        });
      }
    }

    return results;
  }

  async search(query, options = {}) {
    const { timeout = 8000 } = options;
    const url = 'https://html.duckduckgo.com/html/';

    const res = await HttpClient.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        'Referer': 'https://html.duckduckgo.com/'
      },
      data: `q=${encodeURIComponent(query)}&b=`,
      timeout
    });

    if (!res.ok || !res.data) {
      throw new Error(`DuckDuckGo HTTP ${res.status || 'Failed'}`);
    }

    const html = typeof res.data === 'string' ? res.data : String(res.data);

    // Detect bot block / anomaly
    if (html.includes('anomalyDetectionBlock') || html.includes('captcha') || html.includes('bots use duckduckgo')) {
      throw new Error('DuckDuckGo rate limit / bot challenge encountered');
    }

    const parsed = this.parseHtml(html);
    if (parsed.length === 0) {
      throw new Error('DuckDuckGo returned 0 results');
    }

    return parsed;
  }
}
