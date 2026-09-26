import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash2, Edit3, RotateCw, Bot, User, AlertTriangle, X, Loader2, Search, Globe, ChevronDown, ChevronRight, Sparkles, Plug, Share2 } from 'lucide-react';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import ThinkingBlock from './ThinkingBlock';
import { shareCardAsImage } from '../../core/utils/cardShare';
import MeihuaShareModal from './MeihuaShareModal';

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
  const [editMeihuaNumbers, setEditMeihuaNumbers] = useState(null);
  const [expandedToolResults, setExpandedToolResults] = useState({});
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);
  const [sharingMeihuaKey, setSharingMeihuaKey] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const [meihuaShareModalData, setMeihuaShareModalData] = useState(null);
  const meihuaCardRefs = useRef({});

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
    const rawContent = message.content || '';
    const match = rawContent.match(/<meihua-numbers\s+n1="(\d+)"\s+n2="(\d+)"\s+n3="(\d+)"[^>]*>/i) ||
                  rawContent.match(/<meihua-numbers>(\d+)[,\s]+(\d+)[,\s]+(\d+)<\/meihua-numbers>/i);

    if (match) {
      setEditMeihuaNumbers([match[1], match[2], match[3]]);
      setDraftText(rawContent.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '').trim());
    } else {
      setEditMeihuaNumbers(null);
      setDraftText(rawContent);
    }
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftText(message.content || '');
    setEditMeihuaNumbers(null);
    setIsEditing(false);
  };

  const handleNumberChange = (index, value) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 4);
    setEditMeihuaNumbers(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
  };

  const handleSaveEdit = () => {
    let finalContent = draftText.trim();
    if (editMeihuaNumbers && editMeihuaNumbers.length === 3) {
      const [n1, n2, n3] = editMeihuaNumbers.map(n => String(n).trim() || '1');
      finalContent = `<meihua-numbers n1="${n1}" n2="${n2}" n3="${n3}"></meihua-numbers> ${draftText.trim()}`.trimEnd();
    }
    if (finalContent) {
      onEdit?.(message.id, finalContent);
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
        className={`relative rounded-2xl p-3 sm:p-3.5 shadow-sm text-sm break-words overflow-hidden ${
          isUser
            ? 'max-w-[94%] sm:max-w-[85%] bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-br-sm'
            : isFailed
              ? 'w-full max-w-[94%] sm:max-w-[85%] bg-rose-950/40 border border-rose-800/60 text-slate-100 rounded-bl-sm'
              : 'w-full max-w-[94%] sm:max-w-[85%] bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-sm'
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
          <div className="my-1.5 space-y-1.5">
            {message.toolExecutions.map((te, idx) => {
              const isExec = te.status === 'executing' || te.status === 'calling';
              const isExpanded = Boolean(expandedToolResults[te.toolCallId || idx]);

              // Specialized rendering for Meihua Deterministic Calculation Engine
              if (te.toolName === 'meihua_calculation') {
                let parsedResult = te.result;
                if (typeof parsedResult === 'string') {
                  try {
                    parsedResult = JSON.parse(parsedResult);
                  } catch (_) {}
                }
                const calc = parsedResult?.calculation;
                const know = parsedResult?.knowledge;

                const cardKey = te.toolCallId || `meihua_${idx}`;
                const isSharingThis = sharingMeihuaKey === cardKey;

                const handleShareCard = (e) => {
                  e.stopPropagation();
                  setMeihuaShareModalData({ calc, know, cardKey });
                };

                return (
                  <div
                    key={cardKey}
                    ref={el => { meihuaCardRefs.current[cardKey] = el; }}
                    className="rounded-xl bg-gradient-to-r from-rose-950/40 via-[#0e1420] to-purple-950/40 border border-rose-500/30 px-2.5 py-1.5 text-xs shadow-sm"
                  >
                    <div
                      onClick={() => toggleToolResult(cardKey)}
                      className="flex items-center justify-between gap-1.5 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <div className="w-5 h-5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center justify-center text-[11px] shrink-0">
                          🌸
                        </div>
                        <span className="font-bold text-rose-200 text-xs shrink-0">
                          梅花排盤
                        </span>
                        {calc?.primary?.hexagram && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-950/90 text-rose-300 border border-rose-800/80 font-medium truncate">
                            {calc.primary.hexagram.fullName} (動{calc.primary.movingLine}) · 【{calc.tiYong?.relation}】
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-[10px] text-rose-300/80 shrink-0">
                        <span className="font-mono bg-rose-950/70 px-1.5 py-0.5 rounded border border-rose-800/50 text-rose-300">
                          {calc?.method === 'time' ? '⏰ 時間' : calc?.randomNumbers ? `🎲 ${calc.randomNumbers.join(',')}` : '🔢 數字'}
                        </span>
                        <button
                          type="button"
                          onClick={handleShareCard}
                          disabled={isSharingThis}
                          className="p-1 rounded-lg text-rose-300/80 hover:text-white hover:bg-rose-900/50 transition-colors"
                          title="匯出為圖片並分享"
                        >
                          {isSharingThis ? <Loader2 size={13} className="animate-spin text-rose-300" /> : <Share2 size={13} />}
                        </button>
                        {isExpanded ? <ChevronDown size={13} className="text-rose-400" /> : <ChevronRight size={13} className="text-rose-400" />}
                      </div>
                    </div>

                    {isExpanded && calc && (
                      <div className="mt-2 pt-2 border-t border-rose-800/40 space-y-2 text-[11px] animate-fade-in text-slate-300">
                        {/* 3 Hexagram cards */}
                        <div className="grid grid-cols-3 gap-1.5 text-center">
                          <div className="p-1.5 rounded-xl bg-slate-900/90 border border-rose-800/40 space-y-0.5">
                            <div className="text-[10px] text-rose-400 font-semibold">本卦（現狀）</div>
                            <div className="font-bold text-white text-xs">{calc.primary?.hexagram?.fullName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{calc.primary?.upper?.name}({calc.primary?.upper?.element}) / {calc.primary?.lower?.name}({calc.primary?.lower?.element})</div>
                            <div className="text-[10px] text-amber-400 font-bold">動{calc.primary?.movingLine}爻</div>
                          </div>

                          <div className="p-2 rounded-xl bg-slate-900/90 border border-purple-800/40 space-y-0.5">
                            <div className="text-[10px] text-purple-400 font-semibold">互卦（過程）</div>
                            <div className="font-bold text-white text-xs">{calc.mutual?.hexagram?.fullName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{calc.mutual?.upper?.name}({calc.mutual?.upper?.element}) / {calc.mutual?.lower?.name}({calc.mutual?.lower?.element})</div>
                            <div className="text-[10px] text-slate-500">中段內應</div>
                          </div>

                          <div className="p-1.5 rounded-xl bg-slate-900/90 border border-sky-800/40 space-y-0.5">
                            <div className="text-[10px] text-sky-400 font-semibold">變卦（趨勢）</div>
                            <div className="font-bold text-white text-xs">{calc.changed?.hexagram?.fullName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{calc.changed?.upper?.name}({calc.changed?.upper?.element}) / {calc.changed?.lower?.name}({calc.changed?.lower?.element})</div>
                            <div className="text-[10px] text-slate-500">後續走向</div>
                          </div>
                        </div>

                        {/* Ti-Yong Dynamics */}
                        <div className="p-2 rounded-xl bg-black/40 border border-rose-800/30 space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-rose-300">體用五行生剋</span>
                            <span className="px-2 py-0.5 rounded-full font-bold bg-rose-900/60 text-rose-200 border border-rose-700/60">
                              【{calc.tiYong?.relation}】
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-300 flex items-center justify-between pt-0.5">
                            <span>體卦【{know?.ti?.trigram?.name} ({know?.ti?.trigram?.element})】</span>
                            <span className="text-slate-500">vs</span>
                            <span>用卦【{know?.yong?.trigram?.name} ({know?.yong?.trigram?.element})】</span>
                          </div>
                          {know?.relationRule && (
                            <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                              {know.relationRule.nature}：{know.relationRule.summary}（{know.relationRule.guidance}）
                            </p>
                          )}
                        </div>

                        {/* Knowledge Citations */}
                        {know?.primaryHexagram?.judgement && (
                          <div className="p-2 rounded-xl bg-black/30 border border-slate-800 text-[10px] space-y-1">
                            <div className="text-slate-400 font-semibold">周易經文引證：</div>
                            <p className="text-slate-300">【卦辭】{know.primaryHexagram.judgement}</p>
                            {know.movingLine && (
                              <p className="text-amber-300/90">【爻辭】{know.movingLine.name}：{know.movingLine.text}</p>
                            )}
                          </div>
                        )}

                        <div className="text-[10px] text-emerald-400/90 flex items-center gap-1 font-mono">
                          <Check size={12} />
                          <span>已完成確定性數理排盤與體用生剋判定，結果已引導大模型生成。</span>
                        </div>

                        {/* Watermark branding footer for shared card */}
                        <div className="pt-1.5 flex items-center justify-between text-[9px] text-slate-500 border-t border-rose-900/30 font-mono">
                          <span>🌸 梅花易數排盤</span>
                          <span>NvidiaPatch Chat</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

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

              const isCloudSearch = Boolean(
                parsedResult?.effectiveProvider?.startsWith('worker') ||
                parsedResult?.providersUsed?.some(p => typeof p === 'string' && p.startsWith('worker')) ||
                resultsList.some(r => typeof r.source === 'string' && r.source.startsWith('worker'))
              );

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
                        {isCloudSearch && (
                          <span className="px-1.5 py-0.2 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-medium text-[9px] flex items-center gap-0.5">
                            ☁️ Cloud
                          </span>
                        )}
                        {resultCount > 0 && <span>{resultCount} 筆</span>}
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px] animate-fade-in">
                      {Array.isArray(parsedResult?.providerErrors) && parsedResult.providerErrors.length > 0 && (
                        <div className="p-2 rounded bg-amber-950/40 border border-amber-800/50 text-[10px] text-amber-300 space-y-1">
                          <div className="font-semibold flex items-center gap-1">
                            <AlertTriangle size={11} className="shrink-0 text-amber-400" />
                            <span>搜尋引擎診斷與狀態：</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {parsedResult.providerErrors.map((pe, peIdx) => (
                              <span key={peIdx} className="px-1.5 py-0.5 rounded bg-slate-900/80 border border-amber-800/40 font-mono text-[9px]">
                                {pe.provider}: {pe.errorKind === 'challenge' ? '🛡️ 被反爬挑戰(已降級)' : pe.errorKind}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

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
            {/* If message has Meihua random numbers, display editable numeric input fields */}
            {editMeihuaNumbers && (
              <div className="flex items-center justify-between p-2 rounded-xl bg-gradient-to-r from-rose-950/80 to-purple-950/80 border border-rose-500/40 text-rose-200 text-xs shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-rose-300 flex items-center gap-1 text-xs whitespace-nowrap">
                    🎲 靈動數
                  </span>
                  <div className="flex items-center gap-1 font-mono">
                    {editMeihuaNumbers.map((num, i) => (
                      <input
                        key={i}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={num}
                        onChange={(e) => handleNumberChange(i, e.target.value)}
                        className="w-12 sm:w-14 text-center py-1 px-1 rounded-lg bg-rose-900/80 border border-rose-500/60 text-white font-mono font-bold text-xs focus:border-rose-300 focus:bg-rose-900 focus:outline-none shadow-inner"
                        placeholder="0"
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditMeihuaNumbers(null)}
                  className="text-[11px] text-rose-400 hover:text-rose-200 px-1.5 py-0.5 rounded hover:bg-rose-900/40 transition-colors flex items-center gap-0.5 shrink-0"
                  title="移除靈動數（改為時間起卦）"
                >
                  <X size={12} />
                  <span>移除</span>
                </button>
              </div>
            )}

            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700 rounded-xl p-2.5 text-xs text-white resize-none outline-none focus:border-emerald-400 font-sans leading-relaxed select-text shadow-inner"
              rows={3}
              placeholder="請輸入欲修改之問題內容…"
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
          (() => {
            const rawContent = message.content || '';
            const match = rawContent.match(/<meihua-numbers\s+n1="(\d+)"\s+n2="(\d+)"\s+n3="(\d+)"[^>]*>/i) ||
                          rawContent.match(/<meihua-numbers>(\d+)[,\s]+(\d+)[,\s]+(\d+)<\/meihua-numbers>/i);

            const hasImages = Array.isArray(message.images) && message.images.length > 0;

            const renderImages = () => {
              if (!hasImages) return null;
              return (
                <div
                  className={`grid gap-1.5 mb-2 ${
                    message.images.length === 1
                      ? 'grid-cols-1'
                      : message.images.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-2 sm:grid-cols-3'
                  }`}
                >
                  {message.images.map((img, idx) => {
                    const src = typeof img === 'string' ? img : img.url;
                    return (
                      <div
                        key={idx}
                        className="relative group rounded-xl overflow-hidden border border-white/10 bg-black/40 cursor-pointer shadow-sm hover:opacity-90 active:scale-[0.98] transition-all max-w-[280px]"
                        onClick={() => setPreviewImageUrl(src)}
                        title="點擊放大檢視圖片"
                      >
                        <img
                          src={src}
                          alt={img.name || `Image ${idx + 1}`}
                          className="w-full h-auto max-h-56 object-cover"
                          loading="lazy"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            };

            if (match) {
              const n1 = match[1];
              const n2 = match[2];
              const n3 = match[3];
              const cleanText = rawContent.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '').trim();

              return (
                <div className="space-y-1.5 max-w-full overflow-hidden select-text selectable-text">
                  {renderImages()}
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-gradient-to-r from-rose-950/80 to-purple-950/80 border border-rose-500/40 text-rose-200 text-xs shadow-sm">
                    <span className="font-semibold text-rose-300 flex items-center gap-1">🎲 靈動數</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-900/70 border border-rose-700/50 font-mono text-rose-100 font-bold text-[11px]">{n1}</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-900/70 border border-rose-700/50 font-mono text-rose-100 font-bold text-[11px]">{n2}</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-900/70 border border-rose-700/50 font-mono text-rose-100 font-bold text-[11px]">{n3}</span>
                  </div>
                  {cleanText && (
                    <div className="whitespace-pre-wrap break-words break-all leading-relaxed pt-0.5">
                      {cleanText}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div className="max-w-full overflow-hidden select-text selectable-text">
                {renderImages()}
                {rawContent && (
                  <div className="whitespace-pre-wrap break-words break-all leading-relaxed">
                    {rawContent}
                  </div>
                )}
              </div>
            );
          })()
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
              <div className="relative">
                <MarkdownRenderer content={message.content} />
                {isStreaming && isLast && (
                  <span className="inline-block w-2 h-4 ml-1 bg-emerald-400 animate-pulse align-middle rounded-sm shadow-sm shadow-emerald-400/50" />
                )}
              </div>
            ) : isStreaming && isLast ? (
              <div className="flex items-center gap-2 text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 rounded-xl px-2.5 py-1.5 text-xs animate-pulse shadow-inner">
                <Loader2 size={13} className="animate-spin text-emerald-400 shrink-0" />
                <span className="font-sans leading-tight truncate">
                  {activeStatusText || (isReasoningActive ? '正在思考與等待回覆…' : '正在等待回覆…')}
                </span>
              </div>
            ) : message.toolExecutions && message.toolExecutions.length > 0 ? (
              <div className="text-xs text-slate-400 italic py-1">
                已檢索上述資料並整合完成。
              </div>
            ) : null}
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

      {/* Fullscreen Image Preview Lightbox Modal */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div className="relative max-w-full max-h-full flex flex-col items-center">
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
              title="關閉預覽"
            >
              <X size={20} />
            </button>
            <img
              src={previewImageUrl}
              alt="Preview full"
              className="max-w-[95vw] max-h-[85vh] object-contain rounded-xl shadow-2xl border border-slate-700/50"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Meihua Card High-Definition HTML Reconstruction Share Modal */}
      {meihuaShareModalData && (
        <MeihuaShareModal
          isOpen={Boolean(meihuaShareModalData)}
          onClose={() => setMeihuaShareModalData(null)}
          calc={meihuaShareModalData.calc}
          know={meihuaShareModalData.know}
        />
      )}
    </div>
  );
}
