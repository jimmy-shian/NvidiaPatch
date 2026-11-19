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
  totalSearchCalls = 1,
  t = null
}) {
  const tr = (key, fallback, opts) => (typeof t === 'function' ? t(key, fallback, opts) : fallback);
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
        title: cleanQuery
          ? tr('chat.toolSummary.searching', '正在搜尋相關資料')
          : tr('chat.toolSummary.searchingFallback', '正在搜尋資料…'),
        detail: cleanQuery ? `"${cleanQuery}"` : null,
        badge: tr('chat.toolSummary.searchingBadge', '搜尋中'),
        isExecuting: true,
        isCloud: isCloudSearch,
        resultCount: 0
      };
    }

    if (hasFailed) {
      return {
        title: tr('chat.toolSummary.searchFallbackTitle', '搜尋無直接結果，改用備用來源'),
        detail: cleanQuery ? `"${cleanQuery}"` : null,
        badge: tr('chat.toolSummary.switchedBadge', '已切換'),
        isExecuting: false,
        isCloud: isCloudSearch,
        resultCount: 0
      };
    }

    // Completed
    const batchPrefix = totalSearchCalls > 1
      ? tr('chat.toolSummary.roundPrefix', `第 ${index + 1} 輪：`, { round: index + 1 })
      : '';
    let summaryTitle = '';
    if (isCloudSearch) {
      summaryTitle = resultCount > 0
        ? tr('chat.toolSummary.cloudDoneWithCount', `${batchPrefix}雲端搜尋完成，${resultCount} 筆結果`, { prefix: batchPrefix, count: resultCount })
        : tr('chat.toolSummary.cloudDoneNoResult', `${batchPrefix}雲端搜尋完成，無結果`, { prefix: batchPrefix });
    } else {
      summaryTitle = resultCount > 0
        ? tr('chat.toolSummary.localDoneWithCount', `${batchPrefix}搜尋完成，${resultCount} 筆結果`, { prefix: batchPrefix, count: resultCount })
        : tr('chat.toolSummary.localDoneNoResult', `${batchPrefix}搜尋完成，由模型整合`, { prefix: batchPrefix });
    }

    return {
      title: summaryTitle,
      detail: cleanQuery ? `"${cleanQuery}"` : null,
      badge: isCloudSearch ? 'Cloud' : (resultCount > 0 ? tr('chat.toolSummary.resultBadge', `${resultCount} 筆`, { count: resultCount }) : null),
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
        title: tr('chat.toolSummary.mcpExecuting', `執行 MCP 工具 [${rawName}]…`, { name: rawName }),
        detail: cleanQuery ? `"${cleanQuery}"` : null,
        badge: tr('chat.toolSummary.executingBadge', '執行中'),
        isExecuting: true,
        isCloud: false,
        resultCount: 0
      };
    }

    return {
      title: tr('chat.toolSummary.mcpDone', `MCP 工具 [${rawName}] 完成`, { name: rawName }),
      detail: cleanQuery ? `"${cleanQuery}"` : null,
      badge: hasFailed ? tr('chat.toolSummary.failedBadge', '失敗') : tr('chat.toolSummary.doneBadge', '完成'),
      isExecuting: false,
      isCloud: false,
      resultCount
    };
  }

  // 3. General Fallback
  return {
    title: isExecuting
      ? tr('chat.toolSummary.genericExecuting', `執行工具 [${toolName}]…`, { name: toolName })
      : tr('chat.toolSummary.genericDone', `工具 [${toolName}] 完成`, { name: toolName }),
    detail: cleanQuery ? `"${cleanQuery}"` : null,
    badge: isExecuting ? tr('chat.toolSummary.executingBadge', '執行中') : tr('chat.toolSummary.doneBadge', '完成'),
    isExecuting,
    isCloud: false,
    resultCount
  };
}
