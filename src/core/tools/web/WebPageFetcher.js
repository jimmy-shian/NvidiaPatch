/**
 * WebPageFetcher
 * Fetches original public webpages directly via HttpClient,
 * enforcing URL safety checks, timeouts, and readable text extraction.
 */
import { HttpClient } from '../../network/httpClient';
import { validateExternalUrl } from './urlValidator';
import { extractReadableContent } from './ContentExtractor';
import { sanitizeWebContent } from './ContentSanitizer';
import { WorkerSearchProvider } from '../search/WorkerSearchProvider';

export class WebPageFetcher {
  /**
   * Fetch a single webpage, extract its main content, and sanitize the output
   * @param {string} url
   * @param {Object} options
   * @returns {Promise<{ ok: boolean, title?: string, url: string, snippet?: string, content?: string, error?: string }>}
   */
  static async fetch(url, options = {}) {
    const { timeout = 12000, maxChars = 5000 } = options;

    // 1. URL Safety & SSRF Validation
    const validation = validateExternalUrl(url);
    if (!validation.valid) {
      return {
        ok: false,
        url,
        error: validation.reason || 'Invalid or forbidden URL'
      };
    }

    const targetUrl = validation.cleanUrl;

    // 2. Check if Cloudflare Worker proxy is configured & enabled
    try {
      const workerConfig = await WorkerSearchProvider.getConfig();
      if (workerConfig.enabled && workerConfig.url) {
        const workerTimeout = Math.max(timeout, 15000);
        const fetchEndpoint = `${workerConfig.url}/fetch?url=${encodeURIComponent(targetUrl)}&maxChars=${maxChars}`;
        const headers = { 'Accept': 'application/json' };
        if (workerConfig.apiKey) {
          headers['X-Api-Key'] = workerConfig.apiKey;
        }

        const workerRes = await HttpClient.request({
          url: fetchEndpoint,
          method: 'GET',
          headers,
          timeout: workerTimeout
        });

        if (workerRes.ok && workerRes.data) {
          const parsed = typeof workerRes.data === 'string' ? JSON.parse(workerRes.data) : workerRes.data;
          if (parsed && typeof parsed.ok === 'boolean') {
            return parsed;
          }
        }
        // If worker responded with error status, fall through to direct fetch fallback
        console.warn(`[WebPageFetcher Worker route failed (HTTP ${workerRes?.status})], falling back to direct fetch:`, targetUrl);
      }
    } catch (workerErr) {
      console.warn('[WebPageFetcher Worker route error], falling back to direct fetch:', workerErr?.message || workerErr);
    }

    try {
      // 3. Direct Fetch HTML via Native/Browser HttpClient (Fallback)
      const res = await HttpClient.request({
        url: targetUrl,
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout
      });

      if (!res.ok || !res.data) {
        return {
          ok: false,
          url: targetUrl,
          error: `HTTP ${res.status || 'Error'}`
        };
      }

      const rawHtml = typeof res.data === 'string' ? res.data : String(res.data);

      // Check for Cloudflare / bot challenges / paywall barriers
      if (
        rawHtml.includes('cf-browser-verification') ||
        rawHtml.includes('challenge-running') ||
        rawHtml.includes('Attention Required! | Cloudflare') ||
        rawHtml.includes('Checking your browser before accessing')
      ) {
        return {
          ok: false,
          url: targetUrl,
          error: 'Cloudflare / Anti-bot challenge encountered'
        };
      }

      // 3. Extract readable text & metadata
      const extracted = extractReadableContent(rawHtml, targetUrl);

      if (!extracted.mainText || extracted.mainText.length < 50) {
        return {
          ok: false,
          url: targetUrl,
          title: extracted.title || targetUrl,
          error: 'Insufficient readable text in webpage'
        };
      }

      // 4. Sanitize and budget content
      const sanitizedContent = sanitizeWebContent(extracted.mainText, { maxChars });
      const snippet = extracted.description || sanitizedContent.slice(0, 200) + '...';

      return {
        ok: true,
        title: extracted.title || targetUrl,
        url: targetUrl,
        snippet,
        content: sanitizedContent
      };
    } catch (err) {
      return {
        ok: false,
        url: targetUrl,
        error: err.message || 'Fetch failed'
      };
    }
  }

  /**
   * Fetch multiple webpages concurrently with rate limits
   * @param {string[]} urls
   * @param {Object} options
   * @returns {Promise<Array>} List of successfully fetched page objects
   */
  static async fetchMultiple(urls, options = {}) {
    if (!urls || urls.length === 0) return [];
    const limit = options.limit || 3;
    const targetUrls = urls.slice(0, limit);

    const promises = targetUrls.map(u => this.fetch(u, options));
    const results = await Promise.allSettled(promises);

    return results
      .filter(r => r.status === 'fulfilled' && r.value?.ok)
      .map(r => r.value);
  }
}
