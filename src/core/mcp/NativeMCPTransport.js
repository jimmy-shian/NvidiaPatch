/**
 * Native MCP Transport & Credential Dispatcher
 * Securely binds Android Keystore credentials to outgoing MCP HTTP requests
 * without exposing raw secrets to JS logs or Web Storage.
 */
import { SecureStorage } from '../security/secureStorage';

export const NativeMCPTransport = {
  /**
   * Save credential to hardware-backed Keystore
   * @param {string} secretRef - e.g. "keystore://mcp_a83cf928b12e/auth_token"
   * @param {string} secret - Raw token / API key
   */
  async saveCredential(secretRef, secret) {
    if (!secretRef || !secret) return;
    const storageKey = this._refToKey(secretRef);
    await SecureStorage.setItem(storageKey, secret);
  },

  /**
   * Delete credential from Keystore
   * @param {string} secretRef
   */
  async deleteCredential(secretRef) {
    if (!secretRef) return;
    const storageKey = this._refToKey(secretRef);
    await SecureStorage.removeItem(storageKey);
  },

  /**
   * Check if credential exists
   * @param {string} secretRef
   */
  async hasCredential(secretRef) {
    if (!secretRef) return false;
    const storageKey = this._refToKey(secretRef);
    const val = await SecureStorage.getItem(storageKey);
    return Boolean(val);
  },

  /**
   * Internal helper: convert secretRef to SecureStorage key
   */
  _refToKey(secretRef) {
    return secretRef.replace(/[^a-zA-Z0-9_-]/g, '_');
  },

  /**
   * Execute secure HTTP request with native secret injection
   * @param {Object} params
   * @param {string} params.url - Canonical endpoint
   * @param {string} [params.method='POST'] - HTTP method
   * @param {Object} [params.headers={}] - Custom headers
   * @param {any} [params.body] - Request body (JSON-RPC or payload)
   * @param {string} [params.secretRef] - Keystore secret reference
   * @param {string} [params.authType='bearer'] - 'bearer' | 'apiKey' | 'custom'
   * @param {string} [params.authHeaderName='Authorization'] - Header name for API key
   * @param {AbortSignal} [params.signal] - AbortSignal
   * @param {number} [params.timeoutMs=25000] - Request timeout
   */
  async execute({
    url,
    method = 'POST',
    headers = {},
    body = null,
    secretRef = null,
    authType = 'bearer',
    authHeaderName = 'Authorization',
    signal = null,
    timeoutMs = 25000,
    maxRedirects = 3
  }) {
    const finalHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream, */*',
      ...headers
    };

    // Inject Keystore credential right before network dispatch
    if (secretRef) {
      const storageKey = this._refToKey(secretRef);
      const secret = await SecureStorage.getItem(storageKey);
      if (secret && secret.trim()) {
        if (authType === 'bearer') {
          finalHeaders['Authorization'] = `Bearer ${secret.trim()}`;
        } else if (authType === 'apiKey') {
          finalHeaders[authHeaderName] = secret.trim();
        } else {
          finalHeaders['Authorization'] = secret.trim();
        }
      }
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort(new Error(`MCP Request Timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    const onAbort = () => controller.abort(signal.reason);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let currentUrl = url;
    let redirectCount = 0;

    try {
      while (redirectCount <= maxRedirects) {
        let response;
        try {
          response = await fetch(currentUrl, {
            method,
            headers: finalHeaders,
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
            signal: controller.signal
          });
        } catch (fetchErr) {
          // If fetch failed on POST without trailing slash (e.g. browser blocked HTTPS->HTTP redirect from HF Space reverse proxy),
          // retry once with trailing slash if not present
          if (redirectCount === 0 && !currentUrl.endsWith('/') && !currentUrl.includes('?')) {
            currentUrl = currentUrl + '/';
            redirectCount++;
            continue;
          }
          throw fetchErr;
        }

        // Handle explicit redirect status codes (301, 302, 307, 308)
        if ([301, 302, 307, 308].includes(response.status)) {
          const loc = response.headers.get('location');
          if (loc && redirectCount < maxRedirects) {
            redirectCount++;
            let nextUrl = new URL(loc, currentUrl).toString();
            // If original was https: and location gave http: (reverse proxy downgrade on cloud spaces), preserve https:
            if (currentUrl.startsWith('https:') && nextUrl.startsWith('http:')) {
              nextUrl = 'https:' + nextUrl.slice(5);
            }
            currentUrl = nextUrl;
            continue;
          } else if (!currentUrl.endsWith('/') && !currentUrl.includes('?')) {
            // Trailing slash fallback
            redirectCount++;
            currentUrl = currentUrl + '/';
            continue;
          }
        }

        return response;
      }
      throw new Error(`MCP 超過最大重導向次數 (${maxRedirects})`);
    } finally {
      clearTimeout(timeoutTimer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }
};
