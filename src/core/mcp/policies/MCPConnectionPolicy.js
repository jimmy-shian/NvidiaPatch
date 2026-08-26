/**
 * MCP Connection Policy
 * Evaluates connection requests, enforces URL/SSRF policies, connection budgets,
 * and coordinates user trust/approval level.
 */
import { validateMcpUrl, canonicalizeEndpoint } from './MCPURLValidator';

export const MCP_POLICY_LIMITS = {
  MAX_MCP_CONNECTIONS_PER_TURN: 2,
  MAX_REDIRECT_COUNT: 3
};

export const MCPTrustLevel = {
  UNTRUSTED: 'untrusted',
  CHAT_SESSION: 'chat_session',
  ALWAYS_TRUSTED: 'always_trusted'
};

export class MCPConnectionPolicy {
  constructor({ approvalController, maxConnectionsPerTurn = MCP_POLICY_LIMITS.MAX_MCP_CONNECTIONS_PER_TURN } = {}) {
    this.approvalController = approvalController;
    this.maxConnectionsPerTurn = maxConnectionsPerTurn;
    this.sessionConnectionsCount = 0;
    this.sessionTrustedEndpoints = new Set(); // canonical endpoints approved for this session
  }

  resetTurnCounter() {
    this.sessionConnectionsCount = 0;
  }

  addSessionTrustedEndpoint(canonicalEndpoint) {
    this.sessionTrustedEndpoints.add(canonicalEndpoint);
  }

  /**
   * Evaluate a connection request from LLM or UI
   * @param {Object} params
   * @param {string} params.url - Raw URL
   * @param {string} [params.reason] - Explanation / intent
   * @param {Object} [params.knownServer] - Existing server record from DB if any
   * @param {boolean} [params.isManualUserAction=false] - True if initiated directly from UI settings
   * @returns {Promise<{ allowed: boolean, canonicalUrl?: string, error?: string, requiresApproval?: boolean, approvalPayload?: Object }>}
   */
  async evaluateConnectionRequest({
    url,
    reason = '',
    knownServer = null,
    isManualUserAction = false
  }) {
    // 1. Validate URL & SSRF
    const allowLocal = knownServer?.allowPrivateNetwork ?? false;
    const urlValidation = validateMcpUrl(url, { allowLocalNetwork: allowLocal });

    if (!urlValidation.valid) {
      return {
        allowed: false,
        error: `MCP 連線安全策略拒絕: ${urlValidation.error}`
      };
    }

    const canonicalUrl = canonicalizeEndpoint(url);

    // 2. Manual UI action from settings tab is inherently approved by user
    if (isManualUserAction) {
      return { allowed: true, canonicalUrl };
    }

    // 3. Check connection budget per turn (prevent runaway MCP chaining)
    if (this.sessionConnectionsCount >= this.maxConnectionsPerTurn) {
      return {
        allowed: false,
        error: `已達單回合最多連線 MCP 伺服器上限 (${this.maxConnectionsPerTurn} 次)`
      };
    }

    // 4. Check trust level
    if (knownServer && knownServer.trustLevel === MCPTrustLevel.ALWAYS_TRUSTED) {
      this.sessionConnectionsCount++;
      return { allowed: true, canonicalUrl };
    }

    if (this.sessionTrustedEndpoints.has(canonicalUrl)) {
      this.sessionConnectionsCount++;
      return { allowed: true, canonicalUrl };
    }

    // 5. Untrusted / First-time connection requires User Approval via ApprovalController
    if (this.approvalController) {
      const approved = await this.approvalController.requestConnectionApproval({
        url: canonicalUrl,
        reason,
        serverName: knownServer?.displayName || '未命名 MCP 伺服器'
      });

      if (approved.allowed) {
        if (approved.trustScope === MCPTrustLevel.CHAT_SESSION) {
          this.sessionTrustedEndpoints.add(canonicalUrl);
        }
        this.sessionConnectionsCount++;
        return {
          allowed: true,
          canonicalUrl,
          trustScope: approved.trustScope
        };
      } else {
        return {
          allowed: false,
          error: '使用者已拒絕連線至該 MCP 伺服器'
        };
      }
    }

    // Fallback if no approval controller attached: pessimistic rejection
    return {
      allowed: false,
      error: '該端點尚未獲得使用者授權連線'
    };
  }
}
