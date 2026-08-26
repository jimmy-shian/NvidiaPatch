/**
 * MCP Client Adapter
 * Manages protocol transport selection and automatic version negotiation (2026-07-28 Modern vs Legacy).
 */
import { StreamableHttpTransport } from '../transports/StreamableHttpTransport';
import { LegacySseTransport } from '../transports/LegacySseTransport';
import { MCPResponseNormalizer } from './MCPResponseNormalizer';

export class MCPClientAdapter {
  constructor({ endpoint, secretRef = null, authType = 'bearer', protocolVersion = null } = {}) {
    this.endpoint = endpoint;
    this.secretRef = secretRef;
    this.authType = authType;
    this.protocolVersion = protocolVersion; // e.g. '2026-07-28' or '2025-11-25'

    this.streamableTransport = new StreamableHttpTransport({ endpoint, secretRef, authType });
    this.legacyTransport = new LegacySseTransport({ endpoint, secretRef, authType });
    this.activeTransport = this.streamableTransport;
  }

  /**
   * Automatic Version Negotiation & Discovery
   * @param {Object} [options]
   * @returns {Promise<{ protocolVersion: string, serverInfo: Object, capabilities: Object }>}
   */
  async discover(options = {}) {
    // 1. Try modern 2026-07-28 server/discover first over Streamable HTTP
    try {
      const discoverReq = {
        jsonrpc: '2.0',
        id: `disc_${Date.now()}`,
        method: 'server/discover',
        params: {}
      };
      const res = await this.streamableTransport.send(discoverReq, options);
      if (res?.result) {
        this.protocolVersion = '2026-07-28';
        this.activeTransport = this.streamableTransport;
        return {
          protocolVersion: '2026-07-28',
          serverInfo: res.result.serverInfo || { name: 'MCP Server' },
          capabilities: res.result.capabilities || {}
        };
      }
    } catch (modernErr) {
      // If modern discover failed, attempt tools/list directly (stateless modern) or fallback to legacy
    }

    // 2. Try tools/list directly over Streamable HTTP
    try {
      const listReq = {
        jsonrpc: '2.0',
        id: `list_${Date.now()}`,
        method: 'tools/list',
        params: {}
      };
      const res = await this.streamableTransport.send(listReq, options);
      if (res?.result && Array.isArray(res.result.tools)) {
        this.protocolVersion = '2026-07-28';
        this.activeTransport = this.streamableTransport;
        return {
          protocolVersion: '2026-07-28',
          serverInfo: { name: 'MCP Server' },
          capabilities: { tools: {} }
        };
      }
    } catch (_) {}

    // 3. Fallback to Legacy initialize handshake
    try {
      const legacyInit = await this.legacyTransport.initializeSession(options);
      this.protocolVersion = legacyInit?.protocolVersion || '2025-11-25';
      this.activeTransport = this.legacyTransport;
      return {
        protocolVersion: this.protocolVersion,
        serverInfo: legacyInit?.serverInfo || { name: 'Legacy MCP Server' },
        capabilities: legacyInit?.capabilities || {}
      };
    } catch (legacyErr) {
      throw new Error(`MCP 連線與協議協商失敗: ${legacyErr.message}`);
    }
  }

  /**
   * List available tools with cache metadata hints
   * @param {Object} [options]
   * @returns {Promise<{ tools: Array, cacheMetadata: Object }>}
   */
  async listTools(options = {}) {
    const listReq = {
      jsonrpc: '2.0',
      id: `tools_${Date.now()}`,
      method: 'tools/list',
      params: {}
    };

    let response;
    try {
      response = await this.activeTransport.send(listReq, options);
    } catch (err) {
      // If active transport failed, try fallback
      if (this.activeTransport === this.streamableTransport) {
        response = await this.legacyTransport.send(listReq, options);
        this.activeTransport = this.legacyTransport;
      } else {
        throw err;
      }
    }

    if (response?.error) {
      throw new Error(`MCP tools/list 錯誤: ${response.error.message || JSON.stringify(response.error)}`);
    }

    const result = response?.result || {};
    const tools = Array.isArray(result.tools) ? result.tools : [];
    const cacheMetadata = {
      ttlMs: result.ttlMs || null,
      cacheScope: result.cacheScope || 'server',
      receivedAt: Date.now()
    };

    return { tools, cacheMetadata };
  }

  /**
   * Call specific tool
   * @param {string} toolName - original tool name
   * @param {Object} args - invocation arguments
   * @param {Object} [options]
   * @param {string} [options.requestState] - Byte-exact requestState for MRTR
   * @returns {Promise<Object>} Normalized tool response
   */
  async callTool(toolName, args = {}, options = {}) {
    const { requestState = null, signal, timeoutMs = 25000 } = options;

    const callParams = {
      name: toolName,
      arguments: args
    };

    // If this is an MRTR follow-up, echo the opaque requestState
    if (requestState) {
      callParams.requestState = requestState;
    }

    const callReq = {
      jsonrpc: '2.0',
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      method: 'tools/call',
      params: callParams
    };

    const response = await this.activeTransport.send(callReq, { signal, timeoutMs });

    if (response?.error) {
      return {
        isError: true,
        error: response.error.message || 'MCP Tool call failed',
        formattedText: `[MCP Tool Error: ${response.error.message || 'Execution error'}]`,
        taint: 'UNTRUSTED_EXTERNAL_DATA'
      };
    }

    // Check for MRTR input_required
    if (response?.result?.status === 'input_required' || response?.result?.inputRequests) {
      return {
        isMrtrInputRequired: true,
        inputRequests: response.result.inputRequests || [],
        requestState: response.result.requestState || null,
        formattedText: '[MCP 工具需要額外輸入確認]',
        taint: 'UNTRUSTED_EXTERNAL_DATA'
      };
    }

    return MCPResponseNormalizer.normalize(response?.result);
  }
}
