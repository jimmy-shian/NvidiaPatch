/**
 * MCP Interaction Coordinator (MRTR - Multi Round-Trip Requests)
 * Coordinates user elicitation, pending interactive forms, and byte-exact requestState resumption.
 */

export const MAX_MRTR_ROUNDS = 6;

export class MCPInteractionCoordinator {
  constructor() {
    this.pendingInteractions = new Map(); // interactionId -> interaction details
    this.interactionHandler = null; // UI callback handler
  }

  /**
   * Set UI interactive form handler
   * @param {Function} handler - async ({ interactionId, inputRequests, serverName, toolName }) => { responses: Object, cancelled: boolean }
   */
  setInteractionHandler(handler) {
    this.interactionHandler = handler;
  }

  /**
   * Register pending MRTR interaction
   */
  registerInteraction({
    serverId,
    toolName,
    serverName = 'MCP 伺服器',
    originalArgs = {},
    inputRequests = [],
    requestState = null,
    currentRound = 1
  }) {
    if (currentRound > MAX_MRTR_ROUNDS) {
      throw new Error(`MRTR 互動已超過上限輪次 (${MAX_MRTR_ROUNDS} 次)，已自動中止以防迴圈`);
    }

    const interactionId = `mrtr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      interactionId,
      serverId,
      toolName,
      serverName,
      originalArgs,
      inputRequests,
      requestState, // Opaque byte-exact string/object
      round: currentRound,
      createdAt: Date.now()
    };

    this.pendingInteractions.set(interactionId, record);
    return record;
  }

  /**
   * Prompt user for non-sensitive parameters / field choices
   * (Sensitive credentials MUST NOT be collected through form elicitation)
   */
  async promptUserInteraction(interactionId) {
    const record = this.pendingInteractions.get(interactionId);
    if (!record) {
      return { cancelled: true, error: '互動紀錄已過期或不存在' };
    }

    if (this.interactionHandler) {
      try {
        const userResponse = await this.interactionHandler({
          interactionId,
          inputRequests: record.inputRequests,
          serverName: record.serverName,
          toolName: record.toolName
        });
        return userResponse;
      } catch (err) {
        return { cancelled: true, error: err.message };
      }
    }

    return { cancelled: true, error: '無可用的互動式 UI 控制器' };
  }

  /**
   * Clear interaction record
   */
  clearInteraction(interactionId) {
    this.pendingInteractions.delete(interactionId);
  }
}

export const GlobalInteractionCoordinator = new MCPInteractionCoordinator();
