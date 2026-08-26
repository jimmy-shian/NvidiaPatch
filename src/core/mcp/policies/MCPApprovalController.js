/**
 * MCP Approval Controller
 * Manages user approval dialogs/requests for MCP connections and high-risk tool executions.
 */

export class MCPApprovalController {
  constructor() {
    this.approvalHandler = null;
  }

  /**
   * Set custom approval handler (e.g. from React UI hook or modal)
   * @param {Function} handler - async ({ type, payload }) => { allowed: boolean, trustScope: string }
   */
  setApprovalHandler(handler) {
    this.approvalHandler = handler;
  }

  /**
   * Request connection approval
   * @param {Object} payload - { url, reason, serverName }
   * @returns {Promise<{ allowed: boolean, trustScope?: string }>}
   */
  async requestConnectionApproval(payload) {
    if (this.approvalHandler) {
      try {
        return await this.approvalHandler({ type: 'connection', payload });
      } catch (err) {
        console.error('[MCPApprovalController] Connection approval error:', err);
        return { allowed: false };
      }
    }
    // Default fallback (e.g. headless / test mode)
    return { allowed: true, trustScope: 'chat_session' };
  }

  /**
   * Request tool execution approval
   * @param {Object} payload - { serverName, toolName, providerToolName, args, risk, description }
   * @returns {Promise<{ allowed: boolean, trustScope?: string }>}
   */
  async requestToolExecutionApproval(payload) {
    if (this.approvalHandler) {
      try {
        return await this.approvalHandler({ type: 'tool_execution', payload });
      } catch (err) {
        console.error('[MCPApprovalController] Tool execution approval error:', err);
        return { allowed: false };
      }
    }
    // Default fallback
    return { allowed: true, trustScope: 'chat_session' };
  }
}

export const GlobalApprovalController = new MCPApprovalController();
