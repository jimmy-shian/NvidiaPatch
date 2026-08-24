/**
 * Bing HTML Search Provider
 * Scrapes public web SERP from Bing without requiring API keys or user servers.
 * Decodes base64 u=a1 redirect tracking URLs into genuine target URLs.
 */
import { SearchProvider } from './SearchProvider';
import { HttpClient } from '../../network/httpClient';
import { decodeHtmlEntities } from '../web/ContentExtractor';

export class BingHtmlProvider extends SearchProvider {
  constructor() {
    super('bing');
  }

  /**
   * Decode Bing /ck/a?!...&u=a1<base64> redirect URLs into original target URLs
   */
  decodeBingUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';

    const match = rawUrl.match(/[?&]u=a1([A-Za-z0-9_\-\+/=]+)/);
    if (match && match[1]) {
      let b64Str = match[1];
      // Pad base64 string if necessary
      b64Str += '='.repeat((4 - (b64Str.length % 4)) % 4);
      try {
        if (typeof atob === 'function') {
          return atob(b64Str);
        } else if (typeof Buffer !== 'undefined') {
          return Buffer.from(b64Str, 'base64').toString('utf-8');
        }
      } catch (_) {}
    }

    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return rawUrl;
    }
    return '';
  }

  /**
   * Parse Bing HTML SERP into structured results
   */
  parseHtml(html) {
    if (!html || typeof html !== 'string') return [];

    const results = [];
    const seenUrls = new Set();

    // Match <li class="b_algo">...</li>
    const blockRegex = /<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
    let blockMatch;

    while ((blockMatch = blockRegex.exec(html)) !== null && results.length < 10) {
      const block = blockMatch[1];

      // Extract Title & Href: <h2><a href="...">Title</a></h2>
      const titleMatch = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      if (!titleMatch) continue;

      const linkMatch = titleMatch[1].match(/href=["']([^"']+)["']/i);
      if (!linkMatch) continue;

      const rawHref = linkMatch[1].replace(/&amp;/g, '&');
      const realUrl = this.decodeBingUrl(rawHref);

      if (!realUrl || seenUrls.has(realUrl)) continue;
      seenUrls.add(realUrl);

      const rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();

      // Extract Snippet: <div class="b_caption"><p>...</p></div> or <p>...</p>
      const snippetMatch = block.match(/<div\b[^>]*class=["'][^"']*b_caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                           block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);

      const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      results.push({
        title: decodeHtmlEntities(rawTitle || realUrl),
        url: realUrl,
        snippet: decodeHtmlEntities(rawSnippet),
        source: 'bing'
      });
    }

    return results;
  }

  async search(query, options = {}) {
    const { timeout = 8000 } = options;
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-tw`;

    const res = await HttpClient.request({
      url,
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout
    });

    if (!res.ok || !res.data) {
      throw new Error(`Bing HTTP ${res.status || 'Failed'}`);
    }

    const html = typeof res.data === 'string' ? res.data : String(res.data);
    const parsed = this.parseHtml(html);

    if (parsed.length === 0) {
      throw new Error('Bing returned 0 results');
    }

    return parsed;
  }
}
