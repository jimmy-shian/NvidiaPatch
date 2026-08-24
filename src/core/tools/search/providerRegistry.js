/**
 * Search Provider Registry & Health Monitor
 * Manages active search providers (Bing, DuckDuckGo, Mojeek), failure counters, and fallback orchestration.
 */
import { BingHtmlProvider } from './BingHtmlProvider';
import { DuckDuckGoHtmlProvider } from './DuckDuckGoHtmlProvider';
import { MojeekHtmlProvider } from './MojeekHtmlProvider';
import { WikipediaSearchProvider } from './WikipediaSearchProvider';
import { normalizeSearchResults } from './searchNormalizer';

export class SearchProviderRegistry {
  constructor() {
    this.providers = [
      new BingHtmlProvider(),
      new DuckDuckGoHtmlProvider(),
      new MojeekHtmlProvider(),
      new WikipediaSearchProvider()
    ];

    this.healthStats = {
      bing: { failures: 0, lastSuccess: null, lastFailure: null },
      duckduckgo: { failures: 0, lastSuccess: null, lastFailure: null },
      mojeek: { failures: 0, lastSuccess: null, lastFailure: null },
      wikipedia: { failures: 0, lastSuccess: null, lastFailure: null }
    };
  }

  /**
   * Get list of providers sorted by health status
   */
  getPrioritizedProviders() {
    const COOLDOWN_MS = 5 * 60 * 1000;
    const now = Date.now();

    return [...this.providers].sort((a, b) => {
      const statsA = this.healthStats[a.name] || { failures: 0, lastFailure: 0 };
      const statsB = this.healthStats[b.name] || { failures: 0, lastFailure: 0 };

      // Auto-recover after cooldown
      if (statsA.failures >= 3 && statsA.lastFailure && now - statsA.lastFailure > COOLDOWN_MS) {
        statsA.failures = 0;
      }
      if (statsB.failures >= 3 && statsB.lastFailure && now - statsB.lastFailure > COOLDOWN_MS) {
        statsB.failures = 0;
      }

      return statsA.failures - statsB.failures;
    });
  }

  recordSuccess(providerName) {
    if (!this.healthStats[providerName]) {
      this.healthStats[providerName] = { failures: 0, lastSuccess: null, lastFailure: null };
    }
    this.healthStats[providerName].failures = 0;
    this.healthStats[providerName].lastSuccess = Date.now();
  }

  recordFailure(providerName, error) {
    if (!this.healthStats[providerName]) {
      this.healthStats[providerName] = { failures: 0, lastSuccess: null, lastFailure: null };
    }
    this.healthStats[providerName].failures += 1;
    this.healthStats[providerName].lastFailure = Date.now();
    console.warn(`[SearchProvider ${providerName} failure count: ${this.healthStats[providerName].failures}]:`, error?.message || error);
  }

  /**
   * Execute search across prioritized providers with automatic fallback
   * @param {string} query
   * @param {Object} options
   * @returns {Promise<Array<{ title: string, url: string, snippet: string, source: string }>>}
   */
  async search(query, options = {}) {
    const prioritized = this.getPrioritizedProviders();
    let lastError = null;

    for (const provider of prioritized) {
      try {
        const rawResults = await provider.search(query, options);
        if (rawResults && rawResults.length > 0) {
          this.recordSuccess(provider.name);
          return normalizeSearchResults(rawResults, query, options);
        }
      } catch (err) {
        this.recordFailure(provider.name, err);
        lastError = err;
      }
    }

    throw lastError || new Error('All search providers failed to return results');
  }
}

export const defaultSearchRegistry = new SearchProviderRegistry();
