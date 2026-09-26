/**
 * Search Provider Registry & Health Monitor
 * Manages active search providers (Bing, DuckDuckGo, Mojeek), failure counters, and fallback orchestration.
 */
import { WorkerSearchProvider } from './WorkerSearchProvider';
import { BingHtmlProvider } from './BingHtmlProvider';
import { DuckDuckGoHtmlProvider } from './DuckDuckGoHtmlProvider';
import { MojeekHtmlProvider } from './MojeekHtmlProvider';
import { WikipediaSearchProvider } from './WikipediaSearchProvider';
import { normalizeSearchResults } from './searchNormalizer';

export class SearchProviderRegistry {
  constructor() {
    this.providers = [
      new WorkerSearchProvider(),
      new BingHtmlProvider(),
      new DuckDuckGoHtmlProvider(),
      new MojeekHtmlProvider(),
      new WikipediaSearchProvider()
    ];

    this.healthStats = {
      worker: { failures: 0, lastSuccess: null, lastFailure: null },
      bing: { failures: 0, lastSuccess: null, lastFailure: null },
      duckduckgo: { failures: 0, lastSuccess: null, lastFailure: null },
      mojeek: { failures: 0, lastSuccess: null, lastFailure: null },
      wikipedia: { failures: 0, lastSuccess: null, lastFailure: null }
    };
  }

  /**
   * Get list of providers sorted by health status
   * Cloudflare Worker proxy maintains top priority unless facing severe persistent failures (>= 3).
   */
  getPrioritizedProviders() {
    const COOLDOWN_MS = 3 * 60 * 1000;
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

      // Worker priority: if worker has fewer than 3 severe failures, it should always be prioritized
      if (a.name === 'worker' && b.name !== 'worker') {
        if (statsA.failures < 3) return -1;
      }
      if (b.name === 'worker' && a.name !== 'worker') {
        if (statsB.failures < 3) return 1;
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
    // If worker is simply not configured, disabled, or returned 0 results, do NOT treat as a server health failure
    if (providerName === 'worker' && (
      error?.code === 'NOT_CONFIGURED' ||
      error?.errorKind === 'no_results' ||
      error?.message?.includes('0 results')
    )) {
      return;
    }

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
    const providerErrors = options.providerErrors || [];

    for (const provider of prioritized) {
      try {
        const rawResults = await provider.search(query, options);
        if (rawResults && rawResults.length > 0) {
          this.recordSuccess(provider.name);
          return normalizeSearchResults(rawResults, query, options);
        }
      } catch (err) {
        if (provider.name !== 'worker' || err?.code !== 'NOT_CONFIGURED') {
          this.recordFailure(provider.name, err);
          providerErrors.push({
            provider: provider.name,
            errorKind: err.errorKind || (err.message?.includes('bot challenge') || err.message?.includes('captcha') ? 'challenge' : 'error'),
            message: err.message
          });
        }
        lastError = err;
      }
    }

    const failureErr = lastError || new Error('All search providers failed to return results');
    failureErr.providerErrors = providerErrors;
    throw failureErr;
  }
}

export const defaultSearchRegistry = new SearchProviderRegistry();
