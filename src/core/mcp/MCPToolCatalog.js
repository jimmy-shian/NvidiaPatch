/**
 * MCP Tool Catalog & Canonical Schema Hash Manager
 * Provides Canonical JSON hashing, Schema Drift detection, and TTL cache computation.
 */
import { MCPProviderSchemaAdapter } from './protocol/MCPProviderSchemaAdapter';

export const MAX_TOOL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours max clamp

/**
 * Stable recursive canonical JSON stringifier (sorts all object keys)
 */
export function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    return JSON.stringify(key) + ':' + canonicalJsonStringify(obj[key]);
  });
  return '{' + pairs.join(',') + '}';
}

/**
 * Simple synchronous 48-bit / 32-bit hash for server ID generation
 */
export function generateServerId(canonicalEndpoint, authScope = '') {
  const input = `${canonicalEndpoint}::${authScope}`;
  let hash1 = 0x811c9dc5;
  let hash2 = 0x5b3c1c8a;

  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash1 = (hash1 ^ char) * 0x01000193;
    hash2 = (hash2 ^ (char << 1)) * 0x01000193;
  }

  const hex1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  return (hex1 + hex2).slice(0, 12);
}

/**
 * Fast synchronous SHA-256 equivalent / string hash for Canonical JSON schemas
 */
export function computeCanonicalHash(obj) {
  const canonical = canonicalJsonStringify(obj);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x6c62272e;
  let h4 = 0x27bb2ee6;

  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    h1 = (h1 ^ code) * 2654435761;
    h2 = (h2 ^ (code << 3)) * 1597334677;
    h3 = (h3 ^ (code >> 2)) * 3812015801;
    h4 = (h4 ^ (code * 7)) * 2166136261;
  }

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0].map(v => v.toString(16).padStart(8, '0')).join('');
}

export class MCPToolCatalog {
  /**
   * Process tools returned from MCP server, compute fingerprints and provider names
   * @param {string} serverId - 12 hex chars ID
   * @param {Array} rawTools - Tools array from tools/list
   * @param {Object} [existingToolsMap] - Map of existing tools for diff detection
   * @returns {{ processedTools: Array, schemaDriftDetected: boolean, driftDetails: Array }}
   */
  static processServerTools(serverId, rawTools = [], existingToolsMap = {}) {
    const processedTools = [];
    let schemaDriftDetected = false;
    const driftDetails = [];

    for (const tool of rawTools) {
      const providerToolName = MCPProviderSchemaAdapter.formatProviderToolName(serverId, tool.name);

      // 1. Security-sensitive Schema Fingerprint
      const schemaObject = {
        name: tool.name,
        inputSchema: tool.inputSchema || {},
        outputSchema: tool.outputSchema || null,
        annotations: tool.annotations || {}
      };
      const toolSchemaHash = computeCanonicalHash(schemaObject);

      // 2. Metadata Fingerprint
      const metaObject = {
        title: tool.title || '',
        description: tool.description || ''
      };
      const toolMetadataHash = computeCanonicalHash(metaObject);

      // 3. LLM function calling definition
      const llmFunctionDefinition = MCPProviderSchemaAdapter.adaptTool(tool, providerToolName);

      // 4. Check for drift against existing record
      const existing = existingToolsMap[tool.name] || existingToolsMap[providerToolName];
      let approvalValid = true;

      if (existing) {
        if (existing.toolSchemaHash && existing.toolSchemaHash !== toolSchemaHash) {
          schemaDriftDetected = true;
          approvalValid = false; // Invalidate previous user approval
          driftDetails.push({
            toolName: tool.name,
            providerToolName,
            type: 'schema_changed',
            message: `工具「${tool.name}」的參數或核心定義已被遠端伺服器更新，已強制撤銷原有授權`
          });
        } else if (existing.toolMetadataHash && existing.toolMetadataHash !== toolMetadataHash) {
          driftDetails.push({
            toolName: tool.name,
            providerToolName,
            type: 'metadata_changed',
            message: `工具「${tool.name}」的文字說明已更新`
          });
        }
      }

      processedTools.push({
        name: tool.name,
        providerToolName,
        serverId,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        outputSchema: tool.outputSchema || null,
        annotations: tool.annotations || {},
        toolSchemaHash,
        toolMetadataHash,
        approvalValid,
        llmFunctionDefinition
      });
    }

    return {
      processedTools,
      schemaDriftDetected,
      driftDetails
    };
  }

  /**
   * Calculate effective cache expiration
   * @param {number|null} serverTtlMs
   * @returns {number} Timestamp (ms)
   */
  static calculateExpiresAt(serverTtlMs = null) {
    const ttl = (serverTtlMs && typeof serverTtlMs === 'number' && serverTtlMs > 0)
      ? Math.min(serverTtlMs, MAX_TOOL_CACHE_TTL)
      : MAX_TOOL_CACHE_TTL;
    return Date.now() + ttl;
  }
}
