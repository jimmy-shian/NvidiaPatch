/**
 * MCP Tool Policy
 * Evaluates tool execution risk, enforces permissions and user confirmation thresholds.
 */
import { MCPTrustLevel } from './MCPConnectionPolicy';

export const ToolRiskLevel = {
  READ_ONLY: 'read_only',
  MUTATION: 'mutation',
  DESTRUCTIVE: 'destructive',
  SENSITIVE: 'sensitive'
};

export class MCPToolPolicy {
  constructor({ approvalController } = {}) {
    this.approvalController = approvalController;
    this.sessionApprovedTools = new Set(); // tool signatures approved for this session
  }

  /**
   * Classify risk level based on tool schema and annotations
   * @param {Object} tool - Tool definition
   * @param {boolean} isServerTrusted - Whether the parent MCP server is trusted
   * @returns {string} ToolRiskLevel
   */
  classifyToolRisk(tool, isServerTrusted = false) {
    const annotations = tool.annotations || {};
    const nameLower = (tool.name || '').toLowerCase();
    const descLower = (tool.description || '').toLowerCase();

    // 1. Destructive indicators
    if (
      annotations.destructiveHint === true ||
      nameLower.includes('delete') ||
      nameLower.includes('remove') ||
      nameLower.includes('drop') ||
      nameLower.includes('destroy') ||
      descLower.includes('permanently delete')
    ) {
      return ToolRiskLevel.DESTRUCTIVE;
    }

    // 2. Sensitive / Financial / Privacy indicators
    if (
      nameLower.includes('pay') ||
      nameLower.includes('charge') ||
      nameLower.includes('transfer') ||
      nameLower.includes('send_email') ||
      nameLower.includes('export_chat') ||
      descLower.includes('credit card') ||
      descLower.includes('bank')
    ) {
      return ToolRiskLevel.SENSITIVE;
    }

    // 3. Mutation / State write indicators
    if (
      annotations.readOnlyHint === false ||
      nameLower.includes('create') ||
      nameLower.includes('update') ||
      nameLower.includes('write') ||
      nameLower.includes('post') ||
      nameLower.includes('edit') ||
      nameLower.includes('set')
    ) {
      return ToolRiskLevel.MUTATION;
    }

    // 4. Read-only checks
    if (isServerTrusted && annotations.readOnlyHint === true) {
      return ToolRiskLevel.READ_ONLY;
    }

    // Heuristics for common queries
    if (
      nameLower.includes('check') ||
      nameLower.includes('get') ||
      nameLower.includes('list') ||
      nameLower.includes('fetch') ||
      nameLower.includes('search') ||
      nameLower.includes('query') ||
      nameLower.includes('read')
    ) {
      return ToolRiskLevel.READ_ONLY;
    }

    return ToolRiskLevel.MUTATION; // Default pessimistic fallback
  }

  /**
   * Evaluate whether a tool execution is permitted
   * @param {Object} params
   * @param {string} params.providerToolName - e.g. "mcp__a83cf928b12e__tower_check_completion"
   * @param {Object} params.tool - Tool schema & metadata
   * @param {Object} params.args - Invocation arguments
   * @param {Object} params.serverRecord - Parent server entry in DB
   * @returns {Promise<{ allowed: boolean, error?: string }>}
   */
  async evaluateToolCall({
    providerToolName,
    tool,
    args,
    serverRecord
  }) {
    const isServerTrusted = serverRecord?.trustLevel === MCPTrustLevel.ALWAYS_TRUSTED ||
                            serverRecord?.trustLevel === MCPTrustLevel.CHAT_SESSION;

    const risk = this.classifyToolRisk(tool, isServerTrusted);

    // If server is trusted and tool is read-only and server allows autoApproveReadOnly
    if (isServerTrusted && risk === ToolRiskLevel.READ_ONLY && serverRecord?.autoApproveReadOnly !== false) {
      return { allowed: true };
    }

    // Check if user previously approved this specific tool call signature in session
    const callSignature = `${providerToolName}:${JSON.stringify(args)}`;
    if (this.sessionApprovedTools.has(callSignature)) {
      return { allowed: true };
    }

    // Request interactive approval for mutation, destructive, sensitive, or untrusted tools
    if (this.approvalController) {
      const approved = await this.approvalController.requestToolExecutionApproval({
        serverName: serverRecord?.displayName || 'MCP 伺服器',
        toolName: tool.name,
        providerToolName,
        args,
        risk,
        description: tool.description || ''
      });

      if (approved.allowed) {
        if (approved.trustScope === 'chat_session') {
          this.sessionApprovedTools.add(callSignature);
        }
        return { allowed: true };
      } else {
        return {
          allowed: false,
          error: `使用者已拒絕執行 MCP 工具「${tool.name}」`
        };
      }
    }

    return {
      allowed: false,
      error: `MCP 工具「${tool.name}」需要使用者授權確認方可執行`
    };
  }
}
