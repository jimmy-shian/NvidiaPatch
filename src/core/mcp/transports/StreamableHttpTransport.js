import { NativeMCPTransport } from '../NativeMCPTransport';
import { parseMcpResponsePayload } from '../protocol/MCPResponseNormalizer';

export class StreamableHttpTransport {
  constructor({ endpoint, secretRef = null, authType = 'bearer' } = {}) {
    this.endpoint = endpoint;
    this.secretRef = secretRef;
    this.authType = authType;
    this.sessionId = null;
  }

  /**
   * Send JSON-RPC request over Streamable HTTP
   * @param {Object} jsonRpcRequest - { jsonrpc: '2.0', id, method, params }
   * @param {Object} [options]
   * @returns {Promise<any>} Response JSON-RPC payload
   */
  async send(jsonRpcRequest, options = {}) {
    const { signal, timeoutMs = 25000 } = options;

    const headers = {
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': jsonRpcRequest.method || '',
      'Accept': 'application/json, text/event-stream'
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    if (jsonRpcRequest.method === 'tools/call' && jsonRpcRequest.params?.name) {
      headers['Mcp-Name'] = jsonRpcRequest.params.name;
    }

    const res = await NativeMCPTransport.execute({
      url: this.endpoint,
      method: 'POST',
      headers,
      body: jsonRpcRequest,
      secretRef: this.secretRef,
      authType: this.authType,
      signal,
      timeoutMs
    });

    // Capture Session ID if returned by Streamable HTTP server
    const respSessionId = res.headers.get('mcp-session-id');
    if (respSessionId) {
      this.sessionId = respSessionId;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`MCP Streamable HTTP 錯誤 (狀態碼 ${res.status}): ${errText || res.statusText}`);
    }

    const rawText = await res.text();
    return parseMcpResponsePayload(rawText);
  }
}
