/**
 * MCP Response Normalizer & Untrusted Data Pipeline
 * Validates result sizes, sanitizes content, handles structured results,
 * and maintains the UNTRUSTED_EXTERNAL_DATA taint tag.
 */

export const MCP_RESPONSE_LIMITS = {
  MAX_TOOL_RESULT_BYTES: 128 * 1024, // 128 KB hard limit
  TEXT_PREVIEW_LIMIT_BYTES: 32 * 1024  // 32 KB preview for long text
};

/**
 * Parse JSON-RPC response from raw response text (handles both JSON and text/event-stream SSE chunks)
 * @param {string} text
 * @returns {any}
 */
export function parseMcpResponsePayload(text) {
  if (!text || typeof text !== 'string') return {};
  const trimmed = text.trim();

  // 1. Direct JSON parse
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {}
  }

  // 2. SSE event-stream parse (event: message\ndata: { ... })
  const lines = trimmed.split('\n');
  const dataLines = [];
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('data:')) {
      dataLines.push(l.slice(5).trim());
    }
  }

  if (dataLines.length > 0) {
    const joined = dataLines.join('\n');
    try {
      return JSON.parse(joined);
    } catch (_) {
      for (let i = dataLines.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(dataLines[i]);
        } catch (_) {}
      }
    }
  }

  return { result: { content: [{ type: 'text', text: trimmed }] } };
}

export class MCPResponseNormalizer {
  /**
   * Normalize and validate tool call result from MCP server
   * @param {any} rawResult - JSON-RPC result payload from server
   * @param {Object} [options]
   * @param {Object} [options.outputSchema] - Expected outputSchema if defined
   * @returns {{ success: boolean, data: any, formattedText: string, taint: string, isError: boolean }}
   */
  static normalize(rawResult, options = {}) {
    const isError = Boolean(rawResult?.isError);
    let structuredContent = rawResult?.structuredContent || null;
    let contentList = Array.isArray(rawResult?.content) ? rawResult.content : [];

    // Calculate approximate byte size
    const rawJsonString = JSON.stringify(rawResult || {});
    const byteLength = new Blob([rawJsonString]).size;

    if (byteLength > MCP_RESPONSE_LIMITS.MAX_TOOL_RESULT_BYTES) {
      if (structuredContent) {
        return {
          success: false,
          isError: true,
          error: 'TOOL_RESULT_TOO_LARGE: 結構化工具回傳內容超過 128 KB 大小上限，已安全攔截',
          formattedText: '[錯誤: MCP 工具回傳資料超過大小限制 (128 KB)]',
          taint: 'UNTRUSTED_EXTERNAL_DATA'
        };
      }
    }

    // Extract text blocks
    const textPieces = [];
    for (const item of contentList) {
      if (item.type === 'text' && typeof item.text === 'string') {
        textPieces.push(item.text);
      } else if (item.type === 'image') {
        textPieces.push(`[Image: ${item.mimeType || 'image/png'}]`);
      } else if (item.type === 'resource' && item.resource) {
        textPieces.push(`[Resource: ${item.resource.uri || 'unknown'}]`);
      }
    }

    let combinedText = textPieces.join('\n\n');

    // If structuredContent is provided, format it
    if (structuredContent && !combinedText) {
      combinedText = JSON.stringify(structuredContent, null, 2);
    }

    // Bounded preview for oversized text
    const textBytes = new Blob([combinedText]).size;
    if (textBytes > MCP_RESPONSE_LIMITS.TEXT_PREVIEW_LIMIT_BYTES) {
      combinedText = combinedText.slice(0, MCP_RESPONSE_LIMITS.TEXT_PREVIEW_LIMIT_BYTES) +
        `\n\n[... 內容過長已截斷，共 ${Math.round(textBytes / 1024)} KB]`;
    }

    return {
      success: !isError,
      isError,
      structuredContent,
      content: contentList,
      _meta: rawResult?._meta || null,
      formattedText: combinedText,
      taint: 'UNTRUSTED_EXTERNAL_DATA'
    };
  }
}
