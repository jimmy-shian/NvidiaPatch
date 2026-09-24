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
    // If worker is simply not configured or disabled, do not count as a health failure
    if (providerName === 'worker' && error?.code === 'NOT_CONFIGURED') {
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
