/**
 * MCP Tool Selector
 * Dynamically selects a bounded subset of relevant MCP tools (8~16 tools)
 * to avoid context window explosion and optimize LLM tool calling accuracy.
 */

export class MCPToolSelector {
  /**
   * Select relevant tools for current turn
   * @param {Object} params
   * @param {string} params.prompt - Current user prompt or message text
   * @param {Array} params.allEnabledTools - All tools from enabled MCP servers
   * @param {number} [params.maxTools=16] - Maximum tools to inject into LLM schema
   * @returns {Array} Sub-array of selected tool items
   */
  static selectRelevantTools({ prompt = '', allEnabledTools = [], maxTools = 16 }) {
    if (!Array.isArray(allEnabledTools) || allEnabledTools.length === 0) {
      return [];
    }

    // If total tools is within budget, return all tools
    if (allEnabledTools.length <= maxTools) {
      return allEnabledTools;
    }

    const queryLower = (prompt || '').toLowerCase();
    const queryTokens = queryLower
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);

    // Score each tool
    const scored = allEnabledTools.map(tool => {
      let score = 0;
      const nameLower = (tool.name || '').toLowerCase();
      const descLower = (tool.description || '').toLowerCase();
      const providerNameLower = (tool.providerToolName || '').toLowerCase();

      // Exact name substring
      if (nameLower && queryLower.includes(nameLower)) score += 100;
      if (providerNameLower && queryLower.includes(providerNameLower)) score += 100;

      // Token matching
      for (const token of queryTokens) {
        if (nameLower.includes(token)) score += 20;
        if (descLower.includes(token)) score += 10;
        if (tool.inputSchema?.properties) {
          const propKeys = Object.keys(tool.inputSchema.properties).map(k => k.toLowerCase());
          if (propKeys.some(k => k.includes(token))) score += 5;
        }
      }

      return { tool, score };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Take top maxTools
    return scored.slice(0, maxTools).map(item => item.tool);
  }

  /**
   * Search tools by explicit search query (used by search_mcp_tools system tool)
   * @param {string} query
   * @param {Array} allTools
   * @param {number} [limit=8]
   * @returns {Array}
   */
  static searchTools(query, allTools = [], limit = 8) {
    return this.selectRelevantTools({
      prompt: query,
      allEnabledTools: allTools,
      maxTools: limit
    });
  }
}
