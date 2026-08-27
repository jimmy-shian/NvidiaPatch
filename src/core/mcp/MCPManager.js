/**
 * MCP Manager
 * Central controller for Model Context Protocol servers, tools lifecycle,
 * connection discovery, and execution dispatching.
 */
import { LocalDB } from '../storage/localDatabase';
import { NativeMCPTransport } from './NativeMCPTransport';
import { MCPClientAdapter } from './protocol/MCPClientAdapter';
import { MCPToolCatalog, generateServerId } from './MCPToolCatalog';
import { MCPToolSelector } from './MCPToolSelector';
import { MCPConnectionPolicy, MCPTrustLevel } from './policies/MCPConnectionPolicy';
import { MCPToolPolicy } from './policies/MCPToolPolicy';
import { GlobalApprovalController } from './policies/MCPApprovalController';
import { GlobalInteractionCoordinator } from './MCPInteractionCoordinator';
import { MCPProviderSchemaAdapter } from './protocol/MCPProviderSchemaAdapter';
import { canonicalizeEndpoint } from './policies/MCPURLValidator';

export class MCPManagerClass {
  constructor() {
    this.approvalController = GlobalApprovalController;
    this.interactionCoordinator = GlobalInteractionCoordinator;
    this.connectionPolicy = new MCPConnectionPolicy({ approvalController: this.approvalController });
    this.toolPolicy = new MCPToolPolicy({ approvalController: this.approvalController });
    this.clientsCache = new Map(); // serverId -> MCPClientAdapter
  }

  /**
   * Reset per-turn state before a new agent chat run
   */
  resetTurn() {
    this.connectionPolicy.resetTurnCounter();
  }

  /**
   * Get client adapter instance for a server
   */
  getClient(serverRecord) {
    if (!this.clientsCache.has(serverRecord.id)) {
      const client = new MCPClientAdapter({
        endpoint: serverRecord.canonicalEndpoint || serverRecord.endpoint,
        secretRef: serverRecord.secretRef,
        authType: serverRecord.authType || 'bearer',
        protocolVersion: serverRecord.protocolVersion
      });
      this.clientsCache.set(serverRecord.id, client);
    }
    return this.clientsCache.get(serverRecord.id);
  }

  /**
   * List all saved MCP servers
   */
  async getServers() {
    return LocalDB.getMcpServers();
  }

  /**
   * Get single MCP server by ID
   */
  async getServer(id) {
    return LocalDB.getMcpServer(id);
  }

  /**
   * Delete MCP server and remove Keystore credential
   */
  async deleteServer(id) {
    const server = await LocalDB.getMcpServer(id);
    if (server?.secretRef) {
      await NativeMCPTransport.deleteCredential(server.secretRef);
    }
    this.clientsCache.delete(id);
    await LocalDB.deleteMcpServer(id);
  }

  /**
   * Toggle server enabled state
   */
  async toggleServer(id, enabled) {
    return LocalDB.toggleMcpServer(id, enabled);
  }

  /**
   * Connect and register a new or existing MCP Server (from UI or LLM request_mcp_connection)
   * @param {Object} params
   * @param {string} params.url - MCP endpoint URL
   * @param {string} [params.name] - Custom display name
   * @param {string} [params.secretToken] - Optional API key / Bearer token (stored into Keystore)
   * @param {string} [params.authType='bearer'] - 'bearer' | 'apiKey' | 'none'
   * @param {boolean} [params.allowPrivateNetwork=false] - Local network override
   * @param {boolean} [params.isManualUserAction=false] - True if triggered from Settings UI
   * @param {string} [params.reason=''] - Intent reason from LLM
   * @returns {Promise<{ success: boolean, server?: Object, tools?: Array, error?: string, driftDetected?: boolean }>}
   */
  async connectServer({
    url,
    name = '',
    secretToken = '',
    authType = 'bearer',
    allowPrivateNetwork = false,
    isManualUserAction = false,
    reason = ''
  }) {
    // 1. Evaluate connection policy
    const policyResult = await this.connectionPolicy.evaluateConnectionRequest({
      url,
      reason,
      isManualUserAction,
      allowPrivateNetwork
    });

    if (!policyResult.allowed) {
      return { success: false, error: policyResult.error };
    }

    const canonicalEndpoint = policyResult.canonicalUrl;
    const serverId = generateServerId(canonicalEndpoint, authType);
    const secretRef = secretToken ? `keystore://mcp_${serverId}/auth_token` : null;

    // 2. Save credential to hardware Keystore if provided
    if (secretRef && secretToken) {
      await NativeMCPTransport.saveCredential(secretRef, secretToken);
    }

    // 3. Connect and discover protocol
    const client = new MCPClientAdapter({
      endpoint: canonicalEndpoint,
      secretRef,
      authType
    });

    let discoveryResult;
    try {
      discoveryResult = await client.discover();
    } catch (err) {
      return { success: false, error: `MCP 握手連線失敗: ${err.message}` };
    }

    // 4. Fetch tools/list
    let listResult;
    try {
      listResult = await client.listTools();
    } catch (err) {
      return { success: false, error: `取得 MCP 工具清單失敗: ${err.message}` };
    }

    // 5. Process tools and fingerprints
    const existingServer = await LocalDB.getMcpServer(serverId);
    const existingToolsMap = {};
    if (existingServer?.tools) {
      for (const t of existingServer.tools) {
        existingToolsMap[t.name] = t;
      }
    }

    const { processedTools, schemaDriftDetected, driftDetails } = MCPToolCatalog.processServerTools(
      serverId,
      listResult.tools,
      existingToolsMap
    );

    const cacheExpiresAt = MCPToolCatalog.calculateExpiresAt(listResult.cacheMetadata?.ttlMs);
    const displayName = name.trim() || discoveryResult.serverInfo?.name || 'MCP 伺服器';

    const serverRecord = {
      id: serverId,
      displayName,
      endpoint: url,
      canonicalEndpoint,
      protocolVersion: discoveryResult.protocolVersion || '2026-07-28',
      transport: client.activeTransport === client.streamableTransport ? 'streamable_http' : 'legacy_sse',
      authType,
      secretRef,
      enabled: true,
      trustLevel: isManualUserAction ? MCPTrustLevel.ALWAYS_TRUSTED : (policyResult.trustScope || MCPTrustLevel.ALWAYS_TRUSTED),
      allowPrivateNetwork: allowPrivateNetwork || Boolean(policyResult.isPrivateNetwork),
      serverInfo: discoveryResult.serverInfo,
      capabilities: discoveryResult.capabilities,
      tools: processedTools,
      cacheMetadata: listResult.cacheMetadata,
      cacheExpiresAt,
      autoApproveReadOnly: true,
      lastConnectedAt: Date.now(),
      lastSyncedAt: Date.now()
    };

    await LocalDB.saveMcpServer(serverRecord);
    this.clientsCache.set(serverId, client);

    return {
      success: true,
      server: serverRecord,
      tools: processedTools,
      driftDetected: schemaDriftDetected,
      driftDetails
    };
  }

  /**
   * Test connection to an endpoint (used in Settings UI)
   */
  async testConnection({ url, secretToken = '', authType = 'bearer', allowPrivateNetwork = false }) {
    return this.connectServer({
      url,
      secretToken,
      authType,
      allowPrivateNetwork,
      isManualUserAction: true
    });
  }

  /**
   * Synchronize / refresh tools from remote server
   */
  async syncServerTools(serverId) {
    const server = await LocalDB.getMcpServer(serverId);
    if (!server) {
      return { success: false, error: 'MCP 伺服器不存在' };
    }

    const client = this.getClient(server);
    try {
      const { tools, cacheMetadata } = await client.listTools();
      const existingToolsMap = {};
      if (server.tools) {
        for (const t of server.tools) {
          existingToolsMap[t.name] = t;
        }
      }

      const { processedTools, schemaDriftDetected, driftDetails } = MCPToolCatalog.processServerTools(
        serverId,
        tools,
        existingToolsMap
      );

      server.tools = processedTools;
      server.cacheMetadata = cacheMetadata;
      server.cacheExpiresAt = MCPToolCatalog.calculateExpiresAt(cacheMetadata?.ttlMs);
      server.lastSyncedAt = Date.now();

      await LocalDB.saveMcpServer(server);

      return {
        success: true,
        tools: processedTools,
        driftDetected: schemaDriftDetected,
        driftDetails
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get all active tools from all currently enabled servers
   */
  async getAllEnabledTools() {
    const servers = await LocalDB.getMcpServers();
    const enabledServers = servers.filter(s => s.enabled);
    const allTools = [];

    for (const s of enabledServers) {
      if (Array.isArray(s.tools)) {
        allTools.push(...s.tools);
      }
    }

    return allTools;
  }

  /**
   * Get dynamically selected subset of active MCP tools for LLM prompt schema
   * @param {string} prompt - Current prompt
   * @param {number} [maxTools=16] - Max subset size
   * @returns {Promise<Array>} List of OpenAI function schema tools
   */
  async getDynamicToolsForPrompt(prompt = '', maxTools = 16) {
    const allTools = await this.getAllEnabledTools();
    if (allTools.length === 0) return [];

    const selectedTools = MCPToolSelector.selectRelevantTools({
      prompt,
      allEnabledTools: allTools,
      maxTools
    });

    return selectedTools.map(t => t.llmFunctionDefinition);
  }

  /**
   * Search MCP tools explicitly
   */
  async searchTools(query, limit = 8) {
    const allTools = await this.getAllEnabledTools();
    return MCPToolSelector.searchTools(query, allTools, limit);
  }

  /**
   * Execute namespaced MCP Tool
   * @param {string} providerToolName - e.g. "mcp__a83cf928b12e__tower_check_completion"
   * @param {Object} args - Arguments
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async executeTool(providerToolName, args = {}, options = {}) {
    const { isMcpTool, serverId, originalToolName } = MCPProviderSchemaAdapter.parseProviderToolName(providerToolName);
    if (!isMcpTool || !serverId || !originalToolName) {
      throw new Error(`非有效的 MCP 工具名稱: ${providerToolName}`);
    }

    const serverRecord = await LocalDB.getMcpServer(serverId);
    if (!serverRecord) {
      throw new Error(`找不到 ID 為 ${serverId} 的 MCP 伺服器`);
    }

    const toolDef = (serverRecord.tools || []).find(t => t.name === originalToolName);
    if (!toolDef) {
      throw new Error(`在伺服器「${serverRecord.displayName}」中找不到工具「${originalToolName}」`);
    }

    // 1. Evaluate tool execution policy
    const policyResult = await this.toolPolicy.evaluateToolCall({
      providerToolName,
      tool: toolDef,
      args,
      serverRecord
    });

    if (!policyResult.allowed) {
      return {
        isError: true,
        error: policyResult.error || '工具執行遭安全策略拒絕',
        formattedText: `[拒絕: ${policyResult.error || '未獲得執行授權'}]`,
        taint: 'UNTRUSTED_EXTERNAL_DATA'
      };
    }

    // 2. Dispatch call to MCP Client
    const client = this.getClient(serverRecord);
    const result = await client.callTool(originalToolName, args, options);

    // 3. Check for MRTR input_required
    if (result.isMrtrInputRequired) {
      const interactionRecord = this.interactionCoordinator.registerInteraction({
        serverId,
        toolName: originalToolName,
        serverName: serverRecord.displayName,
        originalArgs: args,
        inputRequests: result.inputRequests,
        requestState: result.requestState,
        currentRound: (options.mrtrRound || 1)
      });

      // Prompt UI for interaction
      const promptResult = await this.interactionCoordinator.promptUserInteraction(interactionRecord.interactionId);

      if (promptResult.cancelled) {
        return {
          isError: true,
          error: '使用者已取消互動輸入',
          formattedText: '[已取消互動輸入]',
          taint: 'UNTRUSTED_EXTERNAL_DATA'
        };
      }

      // Resume original request with fresh request ID and byte-exact requestState echo
      return this.executeTool(providerToolName, promptResult.responses || args, {
        ...options,
        requestState: interactionRecord.requestState,
        mrtrRound: (options.mrtrRound || 1) + 1
      });
    }

    return result;
  }
}

export const MCPManager = new MCPManagerClass();
