/**
 * Tool Execution Display Helper
 * Extracts clean, human-meaningful progress summaries from tool execution events.
 * Resolves raw JSON strings, empty quotes, and distinguishes cloud vs local search.
 */

/**
 * Extracts a clean search query or human label from arguments
 */
export function extractCleanQuery(args) {
  if (!args) return '';
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed.query || parsed.q || parsed.url || parsed.question || '';
      } catch (_) {
        return '';
      }
    }
    return trimmed;
  }
  if (typeof args === 'object') {
    return args.query || args.q || args.url || args.question || '';
  }
  return '';
}

/**
 * Formats a clear, concise execution status summary for tool cards
 */
export function formatToolProgressSummary({
  toolName,
  status,
  args,
  result,
  index = 0,
  totalSearchCalls = 1
}) {
  const isExecuting = status === 'executing' || status === 'calling';
  const cleanQuery = extractCleanQuery(args);

  // Parse result payload if stringified
  let parsedResult = result;
  if (typeof parsedResult === 'string') {
    try {
      parsedResult = JSON.parse(parsedResult);
    } catch (_) {}
  }

  const resultsList = Array.isArray(parsedResult?.results)
    ? parsedResult.results
    : (Array.isArray(parsedResult) ? parsedResult : []);

  const resultCount = parsedResult?.resultCount ?? parsedResult?.count ?? resultsList.length;

  const isCloudSearch = Boolean(
    parsedResult?.effectiveProvider?.startsWith('worker') ||
    parsedResult?.providersUsed?.some(p => typeof p === 'string' && p.startsWith('worker')) ||
    resultsList.some(r => typeof r.source === 'string' && r.source.startsWith('worker'))
  );

  const hasFailed = status === 'failed' || status === 'error' || Boolean(parsedResult?.error);

  // 1. Web Search Tool
  if (toolName === 'web_search') {
    if (isExecuting) {
      return {
        title: cleanQuery ? `正在搜尋相關資料` : '正在搜尋與問題相關的資料…',
        detail: cleanQuery ? `"${cleanQuery}"` : null,
        badge: '搜尋中',
        isExecuting: true,
        isCloud: isCloudSearch,
        resultCount: 0
      };
    }

    if (hasFailed) {
      return {
        title: '搜尋未取得直接結果，已切換備用方案',
        detail: cleanQuery ? `"${cleanQuery}"` : null,
        badge: '已切換',
        isExecuting: false,
        isCloud: isCloudSearch,
        resultCount: 0
      };
    }

    // Completed
    const batchPrefix = totalSearchCalls > 1 ? `第 ${index + 1} 輪` : '';
    let summaryTitle = '';
    if (isCloudSearch) {
      summaryTitle = resultCount > 0
        ? `${batchPrefix ? batchPrefix + '：' : ''}雲端搜尋完成，取得 ${resultCount} 筆結果`
        : `${batchPrefix ? batchPrefix + '：' : ''}雲端搜尋完成，無直接結果`;
    } else {
      summaryTitle = resultCount > 0
        ? `${batchPrefix ? batchPrefix + '：' : ''}已整理 ${resultCount} 筆候選資料`
        : `${batchPrefix ? batchPrefix + '：' : ''}搜尋完成，知識庫整合中`;
    }

    return {
      title: summaryTitle,
      detail: cleanQuery ? `"${cleanQuery}"` : null,
      badge: isCloudSearch ? 'Cloud' : (resultCount > 0 ? `${resultCount} 筆` : null),
      isExecuting: false,
      isCloud: isCloudSearch,
      resultCount
    };
  }

  // 2. MCP Tools
  if (toolName?.startsWith('mcp__') || toolName === 'request_mcp_connection' || toolName === 'search_mcp_tools') {
    const rawName = toolName.startsWith('mcp__')
      ? toolName.split('__').slice(2).join('__') || toolName
      : toolName;

    if (isExecuting) {
      return {
        title: `正在執行 MCP 工具 [${rawName}]…`,
        detail: cleanQuery ? `"${cleanQuery}"` : null,
        badge: '執行中',
        isExecuting: true,
        isCloud: false,
        resultCount: 0
      };
    }

    return {
      title: `MCP 工具 [${rawName}] 執行完成`,
      detail: cleanQuery ? `"${cleanQuery}"` : null,
      badge: hasFailed ? '失敗' : '完成',
      isExecuting: false,
      isCloud: false,
      resultCount
    };
  }

  // 3. General Fallback
  return {
    title: isExecuting ? `正在執行 [${toolName}]…` : `已完成工具呼叫 [${toolName}]`,
    detail: cleanQuery ? `"${cleanQuery}"` : null,
    badge: isExecuting ? '執行中' : '完成',
    isExecuting,
    isCloud: false,
    resultCount
  };
}
