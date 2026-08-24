/**
 * Mojeek HTML Search Provider
 * Secondary fallback search provider that queries Mojeek's public web SERP.
 */
import { SearchProvider } from './SearchProvider';
import { HttpClient } from '../../network/httpClient';
import { decodeHtmlEntities } from '../web/ContentExtractor';

export class MojeekHtmlProvider extends SearchProvider {
  constructor() {
    super('mojeek');
  }

  /**
   * Parse Mojeek HTML SERP
   */
  parseHtml(html) {
    if (!html || typeof html !== 'string') return [];

    const results = [];
    const seenUrls = new Set();

    // Match list items in Mojeek results: <ul class="results-standard"> ... <li ...>
    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;

    while ((liMatch = liRegex.exec(html)) !== null && results.length < 10) {
      const liHtml = liMatch[1];

      // Match title and link: <a class="title" href="...">Title</a> or <a class="ob" href="...">
      const linkMatch = liHtml.match(/<a\b[^>]*class=["'][^"']*(?:title|ob)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
                        liHtml.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);

      if (!linkMatch) continue;

      const rawHref = linkMatch[1];
      const rawTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();

      if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://')) continue;
      if (seenUrls.has(rawHref)) continue;
      seenUrls.add(rawHref);

      // Match snippet: <p class="snippet">...</p>
      const snippetMatch = liHtml.match(/<p\b[^>]*class=["'][^"']*snippet[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
      const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      results.push({
        title: decodeHtmlEntities(rawTitle || rawHref),
        url: rawHref,
        snippet: decodeHtmlEntities(rawSnippet),
        source: 'mojeek'
      });
    }

    return results;
  }

  async search(query, options = {}) {
    const { timeout = 8000 } = options;
    const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;

    const res = await HttpClient.request({
      url,
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
      },
      timeout
    });

    if (!res.ok || !res.data) {
      throw new Error(`Mojeek HTTP ${res.status || 'Failed'}`);
    }

    const html = typeof res.data === 'string' ? res.data : String(res.data);
    const parsed = this.parseHtml(html);

    if (parsed.length === 0) {
      throw new Error('Mojeek returned 0 results');
    }

    return parsed;
  }
}
