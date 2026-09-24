/**
 * Worker Search Provider
 * Queries self-hosted Cloudflare Worker search proxy.
 * Highest priority in SearchProviderRegistry when configured.
 */
import { SearchProvider } from './SearchProvider';
import { HttpClient } from '../../network/httpClient';
import { LocalDB } from '../../storage/localDatabase';
import { SecureStorage } from '../../security/secureStorage';

export const WORKER_SEARCH_CONFIG_KEYS = {
  URL: 'cloudflare_worker_search_url',
  ENABLED: 'cloudflare_worker_search_enabled',
  API_KEY: 'cloudflare_worker_api_key'
};

export class WorkerSearchProvider extends SearchProvider {
  constructor() {
    super('worker');
  }

  /**
   * Check if Worker is configured and enabled
   * @returns {Promise<{ enabled: boolean, url: string, apiKey: string }>}
   */
  static async getConfig() {
    const enabled = await LocalDB.getContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, 'false');
    const url = await LocalDB.getContextSetting(WORKER_SEARCH_CONFIG_KEYS.URL, '');
    let apiKey = '';
    try {
      apiKey = await SecureStorage.getItem(WORKER_SEARCH_CONFIG_KEYS.API_KEY) || '';
    } catch (_) {}

    return {
      enabled: enabled === 'true' || enabled === true,
      url: (url || '').trim().replace(/\/+$/, ''),
      apiKey: (apiKey || '').trim()
    };
  }

  /**
   * Save configuration
   */
  static async setConfig({ enabled, url, apiKey }) {
    if (enabled !== undefined) {
      await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.ENABLED, String(enabled));
    }
    if (url !== undefined) {
      await LocalDB.saveContextSetting(WORKER_SEARCH_CONFIG_KEYS.URL, (url || '').trim().replace(/\/+$/, ''));
    }
    if (apiKey !== undefined) {
      await SecureStorage.setItem(WORKER_SEARCH_CONFIG_KEYS.API_KEY, (apiKey || '').trim());
    }
  }

  /**
   * Test connection to Worker /health
   */
  static async testConnection(workerUrl, apiKey = '') {
    if (!workerUrl) {
      return { success: false, message: '請輸入 Cloudflare Worker 網址' };
    }
    const cleanUrl = workerUrl.trim().replace(/\/+$/, '');
    try {
      const res = await HttpClient.request({
        url: `${cleanUrl}/health`,
        method: 'GET',
        headers: {
          ...(apiKey ? { 'X-Api-Key': apiKey } : {})
        },
        timeout: 6000
      });

      if (!res.ok) {
        return { success: false, message: `Worker 連線回應 HTTP ${res.status || '錯誤'}` };
      }

      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      if (data?.status === 'ok') {
        return {
          success: true,
          message: `連線成功！Worker 版本 v${data.version || '1.0.0'}`
        };
      }
      return { success: false, message: '端點回應異常，缺少 status: ok' };
    } catch (err) {
      return { success: false, message: err.message || '無法連線至 Worker 端點' };
    }
  }

  /**
   * Execute search via Worker proxy
   */
  async search(query, options = {}) {
    const config = await WorkerSearchProvider.getConfig();

    if (!config.enabled || !config.url) {
      const notConfiguredErr = new Error('Cloudflare Worker search proxy not configured or disabled');
      notConfiguredErr.code = 'NOT_CONFIGURED';
      throw notConfiguredErr;
    }

    const { timeout = 12000, maxResults = 8, lang = 'zh-TW' } = options;
    const searchUrl = `${config.url}/search?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}&max=${maxResults}`;

    const headers = {
      'Accept': 'application/json'
    };
    if (config.apiKey) {
      headers['X-Api-Key'] = config.apiKey;
    }

    const res = await HttpClient.request({
      url: searchUrl,
      method: 'GET',
      headers,
      timeout
    });

    if (!res.ok || !res.data) {
      const status = res.status || 500;
      const errorObj = new Error(`Worker HTTP ${status}`);
      errorObj.status = status;
      errorObj.errorKind = status === 401 ? 'unauthorized' : `http_${status}`;
      throw errorObj;
    }

    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

    if (data.error) {
      const workerErr = new Error(data.error);
      workerErr.errorKind = data.errorKind || 'worker_error';
      workerErr.providerErrors = data.providerErrors || [];
      throw workerErr;
    }

    const results = data.results || [];
    if (results.length === 0) {
      const emptyErr = new Error('Worker returned 0 results');
      emptyErr.errorKind = 'no_results';
      emptyErr.providerErrors = data.providerErrors || [];
      throw emptyErr;
    }

    return results.map(item => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet || '',
      source: `worker:${item.source || data.effectiveProvider || 'web'}`
    }));
  }
}
