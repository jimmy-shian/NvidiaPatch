/**
 * HttpClient - Native HTTP Client wrapper for Capacitor & Web
 * 
 * Directs requests via CapacitorHttp on native Android to bypass WebView CORS,
 * with standard fetch fallback for browser development.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { sanitizeLog } from '../security/secureStorage';

export const HttpClient = {
  isNative: Capacitor.isNativePlatform(),

  /**
   * Send JSON request (GET / POST)
   */
  async request({ url, method = 'GET', headers = {}, data = null, timeout = 30000 }) {
    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      try {
        const response = await CapacitorHttp.request({
          url,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          },
          data,
          connectTimeout: timeout,
          readTimeout: timeout
        });

        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          data: response.data,
          headers: response.headers
        };
      } catch (err) {
        console.error('[HttpClient Native Error]:', sanitizeLog(err.message));
        throw err;
      }
    } else {
      // Browser fallback
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          },
          body: data ? JSON.stringify(data) : undefined,
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        let responseData;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          responseData = await res.json();
        } else {
          responseData = await res.text();
        }

        return {
          ok: res.ok,
          status: res.status,
          data: responseData,
          headers: Object.fromEntries(res.headers.entries())
        };
      } catch (err) {
        clearTimeout(timeoutId);
        console.error('[HttpClient Fetch Error]:', sanitizeLog(err.message));
        throw err;
      }
    }
  },

  /**
   * Open a fetch stream for SSE / LLM Streaming
   */
  async streamFetch(url, options = {}) {
    const { headers = {}, body, signal } = options;

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal
    });
  }
};
