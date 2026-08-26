import { NativeMCPTransport } from '../NativeMCPTransport';
import { parseMcpResponsePayload } from '../protocol/MCPResponseNormalizer';
import { APP_VERSION } from '../../../version';

export class LegacySseTransport {
  constructor({ endpoint, secretRef = null, authType = 'bearer' } = {}) {
    this.endpoint = endpoint;
    this.secretRef = secretRef;
    this.authType = authType;
    this.sessionId = null;
    this.isInitialized = false;
  }

  /**
   * Initialize legacy session
   */
  async initializeSession(options = {}) {
    if (this.isInitialized) return;

    // Send legacy initialize handshake (supports 2024-11-05 / 2025-11-25)
    const initRequest = {
      jsonrpc: '2.0',
      id: `init_${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false }
        },
        clientInfo: {
          name: 'NvidiaPatchMobile',
          version: APP_VERSION
        }
      }
    };

    const res = await this.sendRaw(initRequest, options);
    if (res?.result?.protocolVersion || res?.result?.serverInfo) {
      // Send initialized notification
      await this.sendRaw({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      }, options).catch(() => {}); // notification ignores response
    }

    this.isInitialized = true;
    return res?.result;
  }

  /**
   * Send JSON-RPC payload
   */
  async send(jsonRpcRequest, options = {}) {
    if (!this.isInitialized && jsonRpcRequest.method !== 'initialize') {
      await this.initializeSession(options);
    }
    return this.sendRaw(jsonRpcRequest, options);
  }

  /**
   * Raw POST dispatcher
   */
  async sendRaw(payload, options = {}) {
    const { signal, timeoutMs = 25000 } = options;

    const headers = {
      'Accept': 'application/json, text/event-stream'
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const res = await NativeMCPTransport.execute({
      url: this.endpoint,
      method: 'POST',
      headers,
      body: payload,
      secretRef: this.secretRef,
      authType: this.authType,
      signal,
      timeoutMs
    });

    if (res.headers.get('mcp-session-id')) {
      this.sessionId = res.headers.get('mcp-session-id');
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`MCP Legacy Transport 錯誤 (HTTP ${res.status}): ${errText || res.statusText}`);
    }

    const text = await res.text();
    return parseMcpResponsePayload(text);
  }
}
