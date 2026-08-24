/**
 * Search Result Normalizer & Deduplication
 * Deduplicates multiple results from the same domain (max 2 per domain unless site: query specified).
 */

function getDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

/**
 * Normalize and deduplicate raw search results
 * @param {Array<{ title: string, url: string, snippet: string, source: string }>} results
 * @param {string} query
 * @param {Object} options
 * @returns {Array<{ title: string, url: string, snippet: string, source: string }>}
 */
export function normalizeSearchResults(results = [], query = '', options = {}) {
  if (!Array.isArray(results)) return [];

  const { maxPerDomain = 2, maxResults = 8 } = options;
  const isSiteSpecific = /site:\s*[^\s]+/i.test(query);

  const domainCount = new Map();
  const normalized = [];

  for (const item of results) {
    if (!item.url || (!item.url.startsWith('http://') && !item.url.startsWith('https://'))) {
      continue;
    }

    const domain = getDomain(item.url);
    if (!domain) continue;

    if (!isSiteSpecific) {
      const count = domainCount.get(domain) || 0;
      if (count >= maxPerDomain) {
        continue;
      }
      domainCount.set(domain, count + 1);
    }

    normalized.push({
      title: item.title?.trim() || item.url,
      url: item.url,
      snippet: item.snippet?.trim() || '',
      source: item.source || 'web'
    });

    if (normalized.length >= maxResults) break;
  }

  return normalized;
}
