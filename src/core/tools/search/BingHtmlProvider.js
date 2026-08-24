/**
 * Bing HTML Search Provider
 * Scrapes public web SERP from Bing without requiring API keys or user servers.
 * Decodes base64 url-safe u=a1 redirect tracking URLs into genuine target URLs.
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

    // If it is already a direct non-Bing target URL
    if ((rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) && !rawUrl.includes('bing.com/ck/')) {
      return rawUrl;
    }

    const match = rawUrl.match(/[?&]u=a1([A-Za-z0-9_\-\+/=]+)/);
    if (match && match[1]) {
      let b64Str = match[1].replace(/-/g, '+').replace(/_/g, '/');
      // Pad base64 string if necessary
      b64Str += '='.repeat((4 - (b64Str.length % 4)) % 4);
      try {
        if (typeof atob === 'function') {
          const binary = atob(b64Str);
          const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
          const decoded = new TextDecoder('utf-8').decode(bytes);
          if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
            return decoded;
          }
        } else if (typeof Buffer !== 'undefined') {
          const decoded = Buffer.from(b64Str, 'base64').toString('utf-8');
          if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
            return decoded;
          }
        }
      } catch (_) {}
    }

    // Never return a Bing tracking redirect link as a valid result URL
    if (rawUrl.includes('bing.com/ck/')) {
      return '';
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

    // Match <li class="b_algo">...</li> or <div class="b_algo">...</div>
    const blockRegex = /<(?:li|div)\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi;
    let blockMatch;

    while ((blockMatch = blockRegex.exec(html)) !== null && results.length < 10) {
      const block = blockMatch[1];

      // Extract Title & Href: <h2><a href="...">Title</a></h2> or <h3><a href="...">Title</a></h3>
      const titleMatch = block.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i);
      const linkMatch = (titleMatch ? titleMatch[1].match(/href=["']([^"']+)["']/i) : null) || block.match(/<a\b[^>]*href=["']([^"']+)["']/i);
      if (!linkMatch) continue;

      const rawHref = linkMatch[1].replace(/&amp;/g, '&');
      const realUrl = this.decodeBingUrl(rawHref);

      if (!realUrl || seenUrls.has(realUrl)) continue;
      seenUrls.add(realUrl);

      const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : (realUrl);

      // Extract Snippet: <div class="b_caption"><p>...</p></div> or <p>...</p> or <div class="b_snippet">
      const snippetMatch = block.match(/<div\b[^>]*class=["'][^"']*(?:b_caption|b_snippet|b_lineclamp)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
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
