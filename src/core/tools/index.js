/**
 * System Tools Registry & Dispatcher
 * Dispatches built-in tools (web_search, request_mcp_connection, search_mcp_tools)
 * and dynamically routed MCP tools (mcp__*).
 */
import { WEB_SEARCH_TOOL_DEFINITION, executeWebSearch } from './webSearch';
import { MCPManager } from '../mcp/MCPManager';

export const REQUEST_MCP_CONNECTION_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'request_mcp_connection',
    description: '請求連線並掛載新的遠端 MCP (Model Context Protocol) 伺服器與其工具。當使用者提供 MCP 端點網址 (如 https://.../mcp) 或要求使用特定 MCP 工具時調用此函數。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '遠端 MCP 伺服器的端點 URL (例如 https://botsz-tower-check-mcp.hf.space/mcp)'
        },
        reason: {
          type: 'string',
          description: '連線該 MCP 伺服器的簡要目的或使用者的需求意圖'
        }
      },
      required: ['url']
    }
  }
};

export const SEARCH_MCP_TOOLS_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'search_mcp_tools',
    description: '搜尋已掛載啟用的 MCP 工具目錄。當目前的工具清單中找不到適用的功能，或需要進一步探索特定領域工具時調用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜尋關鍵字 (例如 "task", "weather", "database", "query")'
        }
      },
      required: ['query']
    }
  }
};

export const SYSTEM_TOOLS = [
  WEB_SEARCH_TOOL_DEFINITION,
  REQUEST_MCP_CONNECTION_TOOL_DEFINITION,
  SEARCH_MCP_TOOLS_TOOL_DEFINITION
];

export async function executeTool(name, args, options = {}) {
  // 1. MCP dynamic tools (mcp__<serverId>__<toolName>)
  if (name && name.startsWith('mcp__')) {
    return MCPManager.executeTool(name, args, options);
  }

  // 2. Built-in tools
  switch (name) {
    case 'web_search':
      return executeWebSearch(args, options);

    case 'request_mcp_connection': {
      const { url, reason = '' } = args || {};
      if (!url) {
        return { isError: true, error: '缺少 URL 參數', formattedText: '[錯誤: 請提供 MCP URL]' };
      }
      const connectResult = await MCPManager.connectServer({
        url,
        reason,
        isManualUserAction: false
      });

      if (!connectResult.success) {
        return {
          isError: true,
          error: connectResult.error || '連線失敗',
          formattedText: `[MCP 連線失敗: ${connectResult.error || '無法連線'}]`,
          taint: 'UNTRUSTED_EXTERNAL_DATA'
        };
      }

      const toolsList = connectResult.tools || [];
      const toolSummaries = toolsList.map(t => `- ${t.name} (${t.providerToolName}): ${t.description || '無描述'}`).join('\n');

      return {
        success: true,
        serverId: connectResult.server.id,
        serverName: connectResult.server.displayName,
        protocolVersion: connectResult.server.protocolVersion,
        toolsCount: toolsList.length,
        tools: toolsList.map(t => ({ name: t.name, providerToolName: t.providerToolName, description: t.description })),
        formattedText: `已成功連線並掛載 MCP 伺服器「${connectResult.server.displayName}」(${connectResult.server.protocolVersion})！\n可用工具 (${toolsList.length} 個):\n${toolSummaries}`,
        taint: 'UNTRUSTED_EXTERNAL_DATA'
      };
    }

    case 'search_mcp_tools': {
      const { query = '' } = args || {};
      const found = await MCPManager.searchTools(query, 8);
      if (found.length === 0) {
        return {
          success: true,
          results: [],
          formattedText: `在已啟用的 MCP 伺服器中未找到與「${query}」相符的工具。`
        };
      }
      const listText = found.map(t => `- ${t.name} (${t.providerToolName}): ${t.description}`).join('\n');
      return {
        success: true,
        results: found.map(t => ({ name: t.name, providerToolName: t.providerToolName, description: t.description })),
        formattedText: `找到 ${found.length} 個相符的 MCP 工具：\n${listText}`
      };
    }

    default:
      throw new Error(`Tool "${name}" is not implemented`);
  }
}
