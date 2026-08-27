import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash2, Edit3, RotateCw, Bot, User, AlertTriangle, X, Loader2, Search, Globe, ChevronDown, ChevronRight, Sparkles, Plug } from 'lucide-react';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import ThinkingBlock from './ThinkingBlock';

export default function MessageBubble({
  message,
  isLast,
  isStreaming,
  isReasoningActive,
  liveStatus,
  onRegenerate,
  onDelete,
  onEdit
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [draftText, setDraftText] = useState(message.content || '');
  const [expandedToolResults, setExpandedToolResults] = useState({});
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  if (message.role === 'system') return null; // Never render hidden system messages

  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isFailed = !isUser && (message.content?.includes('[錯誤]') || message.content?.includes('[Error]'));

  // Live timer for active streaming assistant turn
  useEffect(() => {
    if (!isStreaming || !isLast || isUser) return;
    const startTime = message.startedAt || message.createdAt || Date.now();
    setLiveElapsedMs(Date.now() - startTime);

    const timer = setInterval(() => {
      setLiveElapsedMs(Date.now() - startTime);
    }, 100);

    return () => clearInterval(timer);
  }, [isStreaming, isLast, isUser, message.startedAt, message.createdAt]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleStartEdit = () => {
    setDraftText(message.content || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftText(message.content || '');
    setIsEditing(false);
  };

  const handleSaveEdit = () => {
    if (draftText.trim()) {
      onEdit?.(message.id, draftText.trim());
    }
    setIsEditing(false);
  };

  const handleDeleteConfirm = () => {
    onDelete?.(message.id);
    setIsConfirmingDelete(false);
  };

  const toggleToolResult = (id) => {
    setExpandedToolResults(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Timestamp string
  const timestamp = message.startedAt || message.createdAt || Date.now();
  const timeStr = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  // Duration display string
  let durationText = null;
  if (!isUser) {
    if (isStreaming && isLast) {
      const sec = Math.max(0.1, (liveElapsedMs / 1000)).toFixed(1);
      durationText = `處理中 ${sec}s`;
    } else if (message.durationMs !== undefined && message.durationMs !== null) {
      durationText = `回應耗時 ${(message.durationMs / 1000).toFixed(1)}s`;
    } else if (message.completedAt && message.startedAt) {
      durationText = `回應耗時 ${((message.completedAt - message.startedAt) / 1000).toFixed(1)}s`;
    }
  }

  // Map ephemeral progress status
  const getLiveStatusText = () => {
    if (!liveStatus) return null;
    const { phase, meta = {} } = liveStatus;
    switch (phase) {
      case 'thinking':
        return '正在思考與分析問題…';
      case 'searching':
        return meta.query ? `正在搜尋相關資料: "${meta.query}"…` : '正在搜尋相關資料…';
      case 'retrying_query':
        return meta.relaxedQuery
          ? `第一次搜尋無直接結果，正在更換關鍵字重新檢索: "${meta.relaxedQuery}"…`
          : '正在調整關鍵字重新搜尋…';
      case 'reading':
        if (meta.resultCount && (meta.pagesToReadCount || meta.count)) {
          return `找到 ${meta.resultCount} 筆結果，正在閱讀其中 ${meta.pagesToReadCount || meta.count} 個來源…`;
        }
        return meta.pagesToReadCount || meta.count
          ? `正在檢索並閱讀 ${meta.pagesToReadCount || meta.count} 個來源網頁…`
          : '正在檢索並閱讀來源網頁…';
      case 'using_tool':
        return `正在調用工具: ${meta.toolName || ''}…`;
      case 'organizing':
        return '已獲取相關資料，正在整理回答…';
      case 'generating':
        return '正在生成回覆…';
      default:
        return null;
    }
  };

  const activeStatusText = isStreaming && isLast ? getLiveStatusText() : null;

  // Render standalone Tool Result message if in history
  if (isTool) {
    let parsedContent = null;
    try {
      parsedContent = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
    } catch (_) {
      parsedContent = message.content;
    }

    const queryStr = parsedContent?.query || '';
    const resultsList = Array.isArray(parsedContent?.results) ? parsedContent.results : [];
    const resultsCount = parsedContent?.resultCount ?? parsedContent?.count ?? resultsList.length;
    const isExpanded = Boolean(expandedToolResults[message.id]);

    return (
      <div className="flex flex-col my-1.5 px-2 w-full items-start">
        <div className="max-w-[92%] sm:max-w-[85%] rounded-xl p-2.5 bg-slate-900/70 border border-slate-800 text-xs text-slate-300">
          <button
            type="button"
            onClick={() => toggleToolResult(message.id)}
            className="w-full flex items-center justify-between gap-2 text-left hover:text-white"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Globe size={13} className="text-emerald-400 shrink-0" />
              <span className="font-semibold text-emerald-300">搜尋工具結果:</span>
              <span className="text-slate-400 font-mono truncate">{queryStr || message.name || 'web_search'}</span>
              <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.2 rounded shrink-0">
                {resultsCount} 筆
              </span>
            </div>
            {isExpanded ? <ChevronDown size={13} className="text-slate-500 shrink-0" /> : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
          </button>

          {isExpanded && (
            <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5 text-[11px] animate-fade-in">
              {resultsList.length > 0 ? (
                resultsList.map((r, i) => (
                  <div key={i} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-400 hover:underline truncate block">
                      {r.title}
                    </a>
                    <p className="text-slate-400 mt-0.5 line-clamp-2">{r.snippet || r.content}</p>
                  </div>
                ))
              ) : (
                <div className="p-2 rounded bg-black/30 text-slate-400 text-xs italic">
                  未檢索到直接相關網頁或已由模型知識庫整合。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col my-2 px-1 sm:px-2 w-full ${isUser ? 'items-end' : 'items-start'}`}>
      {/* Sender Header with Time & Elapsed Duration */}
      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium text-slate-400 select-none">
        {isUser ? (
          <>
            <span className="font-mono text-slate-500 text-[10px]">{timeStr}</span>
            <span className="text-slate-600">·</span>
            <span>您</span>
            <User size={12} className="text-slate-400" />
          </>
        ) : (
          <>
            <Bot size={13} className="text-emerald-400 shrink-0" />
            <span className="text-emerald-400 font-semibold">{message.modelName || 'Assistant'}</span>
            <span className="text-slate-600">·</span>
            <span className="font-mono text-slate-500 text-[10px]">{timeStr}</span>
            {durationText && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-400/90 font-mono text-[10px] bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.2 rounded">
                  {durationText}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* Bubble Container */}
      <div
        className={`relative max-w-[94%] sm:max-w-[85%] rounded-2xl p-3 sm:p-3.5 shadow-sm text-sm break-words overflow-hidden ${
          isUser
            ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-br-sm'
            : isFailed
              ? 'bg-rose-950/40 border border-rose-800/60 text-slate-100 rounded-bl-sm'
              : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-sm'
        }`}
      >
        {/* Ephemeral Progress Status Row (only during live streaming) */}
        {!isUser && activeStatusText && (
          <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/70 border border-emerald-800/60 rounded-xl px-2.5 py-1.5 mb-2.5 animate-fade-in shadow-inner">
            <Loader2 size={13} className="animate-spin text-emerald-400 shrink-0" />
            <span className="font-sans leading-tight truncate">{activeStatusText}</span>
          </div>
        )}

        {/* Thinking process for Assistant */}
        {!isUser && (
          <ThinkingBlock
            thinkingContent={message.thinkingContent}
            isStreaming={isStreaming && isLast}
            isReasoningActive={isReasoningActive && isLast}
          />
        )}

        {/* Live Tool Executions within this assistant turn */}
        {!isUser && message.toolExecutions && message.toolExecutions.length > 0 && (
          <div className="my-2 space-y-1.5">
            {message.toolExecutions.map((te, idx) => {
              const isExec = te.status === 'executing' || te.status === 'calling';
              const isMcp = te.toolName?.startsWith('mcp__') || te.toolName === 'request_mcp_connection' || te.toolName === 'search_mcp_tools';
              const queryStr = typeof te.args === 'object' ? (te.args?.query || te.args?.url || te.args?.taskId || JSON.stringify(te.args)) : te.args;

              let parsedResult = te.result;
              if (typeof parsedResult === 'string') {
                try {
                  parsedResult = JSON.parse(parsedResult);
                } catch (_) {}
              }
              const resultsList = Array.isArray(parsedResult?.results) ? parsedResult.results : (Array.isArray(parsedResult) ? parsedResult : []);
              const resultCount = parsedResult?.resultCount ?? parsedResult?.count ?? resultsList.length;
              const isExpanded = Boolean(expandedToolResults[te.toolCallId || idx]);

              let toolTitle = '搜尋工具';
              if (te.toolName === 'request_mcp_connection') {
                toolTitle = isExec ? '正在連線 MCP 伺服器…' : '已連線 MCP 伺服器';
              } else if (te.toolName === 'search_mcp_tools') {
                toolTitle = isExec ? '正在搜尋 MCP 工具…' : '已搜尋 MCP 工具';
              } else if (te.toolName?.startsWith('mcp__')) {
                const parts = te.toolName.split('__');
                const rawName = parts.length >= 3 ? parts.slice(2).join('__') : te.toolName;
                toolTitle = isExec ? `正在執行 MCP [${rawName}]…` : `MCP 工具 [${rawName}]`;
              } else {
                toolTitle = isExec ? '正在搜尋…' : '已完成搜尋';
              }

              return (
                <div key={te.toolCallId || idx} className="rounded-xl bg-slate-950/80 border border-slate-800 p-2 text-xs">
                  <div
                    onClick={() => te.result && toggleToolResult(te.toolCallId || idx)}
                    className="flex items-center justify-between gap-2 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                      {isExec ? (
                        <Loader2 size={13} className="animate-spin text-emerald-400 shrink-0" />
                      ) : isMcp ? (
                        <Plug size={13} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Search size={13} className="text-emerald-400 shrink-0" />
                      )}
                      <span className="font-semibold text-emerald-300 whitespace-nowrap shrink-0">
                        {toolTitle}
                      </span>
                      {queryStr && (
                        <span className="text-slate-400 font-mono truncate min-w-0 flex-1">
                          "{queryStr}"
                        </span>
                      )}
                    </div>

                    {!isExec && te.result && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                        {resultCount > 0 && <span>{resultCount} 筆</span>}
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px] animate-fade-in">
                      {parsedResult?.formattedText ? (
                        <div className="p-2 rounded bg-black/50 border border-slate-800/80 whitespace-pre-wrap font-mono text-slate-300 text-[11px]">
                          {parsedResult.formattedText}
                        </div>
                      ) : resultsList.length > 0 ? (
                        resultsList.map((r, ri) => (
                          <div key={ri} className="p-1.5 rounded bg-black/50 border border-slate-800/80">
                            {r.url ? (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-400 hover:underline truncate block">
                                {r.title || r.name}
                              </a>
                            ) : (
                              <span className="font-semibold text-emerald-400 block">{r.name || r.title}</span>
                            )}
                            <p className="text-slate-400 mt-0.5 line-clamp-2">{r.snippet || r.content || r.description}</p>
                          </div>
                        ))
                      ) : (
                        <div className="p-2 rounded bg-black/30 text-slate-400 text-xs italic font-mono">
                          {typeof parsedResult === 'object' ? JSON.stringify(parsedResult, null, 2) : String(parsedResult)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Message body / Edit Box */}
        {isEditing ? (
          <div className="flex flex-col gap-2 mt-1 min-w-[240px] max-w-full">
            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700 rounded-xl p-2.5 text-xs text-white resize-none outline-none focus:border-emerald-400 font-sans leading-relaxed select-text shadow-inner"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-xs font-medium"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!draftText.trim()}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 font-semibold text-white transition-colors disabled:opacity-40 text-xs shadow-sm shadow-emerald-950/30"
              >
                儲存並送出
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap break-words break-all leading-relaxed max-w-full overflow-hidden select-text selectable-text">{message.content}</div>
        ) : isFailed ? (
          <div className="space-y-2 max-w-full overflow-hidden">
            <div className="flex items-center gap-1.5 text-rose-400 font-semibold text-xs">
              <AlertTriangle size={14} className="shrink-0" />
              <span>回覆失敗</span>
            </div>
            <div className="text-xs text-rose-300/90 whitespace-pre-wrap break-words break-all leading-relaxed max-w-full overflow-hidden">
              {message.content}
            </div>
            <button
              type="button"
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/50 text-rose-200 text-xs font-semibold transition-all active:scale-95 mt-2"
            >
              <RotateCw size={13} />
              <span>重新嘗試</span>
            </button>
          </div>
        ) : (
          <div className="relative leading-relaxed">
            {message.content ? (
              <MarkdownRenderer content={message.content} />
            ) : isStreaming && isLast ? (
              <div className="flex items-center gap-2 text-slate-300 py-1 text-xs animate-pulse">
                <Loader2 size={13} className="animate-spin text-emerald-400 shrink-0" />
                <span>{isReasoningActive ? '正在思考與等待回覆…' : '正在等待回覆…'}</span>
              </div>
            ) : message.toolExecutions && message.toolExecutions.length > 0 ? (
              <div className="text-xs text-slate-400 italic py-1">
                已檢索上述資料並整合完成。
              </div>
            ) : null}
            {isStreaming && isLast && !isReasoningActive && message.content && (
              <span className="inline-block w-1.5 h-4 ml-1 bg-emerald-400 animate-pulse align-middle rounded-sm" />
            )}
          </div>
        )}
      </div>

      {/* Action buttons toolbar & Delete Confirmation */}
      {!isEditing && (
        <div className="flex items-center gap-2 mt-1 px-1 text-slate-500 text-xs opacity-70 hover:opacity-100 transition-opacity">
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-800/80 rounded-lg px-2 py-0.5 text-[11px] text-rose-300 animate-fade-in">
              <span>確定刪除？</span>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-1.5 py-0.2 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold"
              >
                刪除
              </button>
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                className="px-1 py-0.2 text-slate-400 hover:text-slate-200"
              >
                取消
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 hover:text-slate-200 transition-colors"
                title="複製內容"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>

              {isUser && !isStreaming && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="p-1 hover:text-slate-200 transition-colors"
                  title="編輯此訊息"
                >
                  <Edit3 size={12} />
                </button>
              )}

              {!isUser && isLast && !isStreaming && !isFailed && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="p-1 hover:text-slate-200 transition-colors"
                  title="重新生成回覆"
                >
                  <RotateCw size={12} />
                </button>
              )}

              {!isStreaming && (
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(true)}
                  className="p-1 hover:text-rose-400 transition-colors"
                  title="刪除此訊息"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
