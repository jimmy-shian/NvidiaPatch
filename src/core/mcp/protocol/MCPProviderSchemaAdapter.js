/**
 * MCP Provider Schema Adapter
 * Adapts MCP Tool definitions (JSON Schema 2020-12) to LLM Provider Tool specifications (OpenAI / NVIDIA NIM).
 */

export class MCPProviderSchemaAdapter {
  /**
   * Adapt MCP tool to LLM function calling schema
   * @param {Object} tool - MCP Tool { name, description, inputSchema, annotations }
   * @param {string} providerToolName - Namespaced tool name, e.g. "mcp__a83cf928b12e__tower_check_completion"
   * @returns {Object} OpenAI-compatible tool definition
   */
  static adaptTool(tool, providerToolName) {
    const inputSchema = tool.inputSchema || { type: 'object', properties: {} };

    // Clean description to avoid empty descriptions or excessive whitespace
    const cleanDesc = (tool.description || `MCP tool ${tool.name}`).trim();

    // Ensure parameters object is valid JSON Schema for OpenAI / NVIDIA function calling
    const parameters = {
      type: 'object',
      properties: inputSchema.properties || {},
      required: Array.isArray(inputSchema.required) ? inputSchema.required : []
    };

    if (inputSchema.additionalProperties !== undefined) {
      parameters.additionalProperties = inputSchema.additionalProperties;
    }

    return {
      type: 'function',
      function: {
        name: providerToolName,
        description: cleanDesc,
        parameters
      }
    };
  }

  /**
   * Parse provider tool name into server ID and original tool name
   * @param {string} providerToolName - e.g. "mcp__a83cf928b12e__tower_check_completion"
   * @returns {{ isMcpTool: boolean, serverId?: string, originalToolName?: string }}
   */
  static parseProviderToolName(providerToolName) {
    if (!providerToolName || typeof providerToolName !== 'string') {
      return { isMcpTool: false };
    }

    const match = providerToolName.match(/^mcp__([a-zA-Z0-9_-]+)__(.+)$/);
    if (match) {
      return {
        isMcpTool: true,
        serverId: match[1],
        originalToolName: match[2]
      };
    }

    return { isMcpTool: false };
  }

  /**
   * Generate namespaced provider tool name
   * @param {string} serverId - 12 hex chars or clean alphanumeric ID
   * @param {string} originalToolName
   * @returns {string} e.g. "mcp__a83cf928b12e__tower_check"
   */
  static formatProviderToolName(serverId, originalToolName) {
    const cleanServerId = (serverId || 'srv').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
    const cleanToolName = (originalToolName || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    return `mcp__${cleanServerId}__${cleanToolName}`;
  }
}
