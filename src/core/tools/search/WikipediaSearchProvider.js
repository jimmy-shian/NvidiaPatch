/**
 * Wikipedia Search Provider
 * Ultra-reliable, zero-cost, CORS-free public encyclopedia search endpoint.
 * Serves as an authoritative factual fallback for public knowledge queries.
 */
import { SearchProvider } from './SearchProvider';
import { HttpClient } from '../../network/httpClient';
import { decodeHtmlEntities } from '../web/ContentExtractor';

export class WikipediaSearchProvider extends SearchProvider {
  constructor() {
    super('wikipedia');
  }

  async search(query, options = {}) {
    const { timeout = 8000 } = options;
    const isChinese = /[\u4e00-\u9fa5]/.test(query);
    const domain = isChinese ? 'zh.wikipedia.org' : 'en.wikipedia.org';
    const url = `https://${domain}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=6`;

    const res = await HttpClient.request({
      url,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NvidiaPatch-Mobile/0.1.8 (https://github.com/jimmy-shian/NvidiaPatch; contact@example.com)'
      },
      timeout
    });

    if (!res.ok || !res.data) {
      throw new Error(`Wikipedia HTTP ${res.status || 'Failed'}`);
    }

    const searchItems = res.data?.query?.search || [];
    if (!Array.isArray(searchItems) || searchItems.length === 0) {
      throw new Error('Wikipedia returned 0 results');
    }

    return searchItems.map(item => ({
      title: item.title,
      url: `https://${domain}/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`,
      snippet: decodeHtmlEntities(item.snippet ? item.snippet.replace(/<[^>]+>/g, '') : ''),
      source: 'wikipedia'
    }));
  }
}
