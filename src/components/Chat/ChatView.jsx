import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Settings, ChevronDown, Bot, Sparkles, Minimize2, Loader2, Zap, AlertCircle, ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import InlineWaitingAd from './InlineWaitingAd';
import ChatInput from './ChatInput';
import MeihuaActionBar from './MeihuaActionBar';
import { formatTokenNumber } from '../../core/context/modelLimits';

// Scroll-rail marker offset (matches .chat-message-anchor scroll-margin-top)
const SCROLL_MARKER_OFFSET = 14;
// Distance from bottom (px) that triggers collapsing / restoring the context bar
const CONTEXT_COLLAPSE_DISTANCE = 80;
const CONTEXT_EXPAND_DISTANCE = 25;

export default function ChatView({
  conversation,
  messages = [],
  input,
  setInput,
  isStreaming,
  isReasoningActive,
  isCompressing,
  liveStatus = null,
  contextStats = { usedTokens: 0, maxTokens: 32768, threshold: 26214, isNearLimit: false },
  compressionToast,
  onCompressContext,
  onSend,
  onStop,
  onRegenerate,
  onDeleteMessage,
  onEditMessage,
  currentProviderName,
  currentModelId,
  onOpenModelSelector,
  onOpenDrawer,
  onOpenSettings,
  availableSkills = [],
  selectedSkillIds = [],
  onToggleSkill,
  conversationType,
  onRandomCast,
  onShowHelp,
  attachedImages = [],
  onAddImages,
  onRemoveImage,
  onClearImages
}) {
  const { t } = useTranslation();
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const autoFollowRef = useRef(true);
  const touchStartYRef = useRef(null);
  const touchStartXRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const rafPendingRef = useRef(false);
  const markerNodesRef = useRef([]);
  const markerRafRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [contextBarCollapsed, setContextBarCollapsed] = useState(false);
  const [scrollTicks, setScrollTicks] = useState([]);
  const [activeTickId, setActiveTickId] = useState(null);

  // Highlight the marker matching the message currently at the top of the viewport
  const updateActiveMarker = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nodes = markerNodesRef.current;
    let activeId = null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      if (node.offsetTop - el.scrollTop <= SCROLL_MARKER_OFFSET + 6) {
        activeId = node.getAttribute('data-msg-id');
      } else {
        break;
      }
    }
    setActiveTickId((prev) => (prev === activeId ? prev : activeId));
  }, []);

  const scheduleActiveMarkerUpdate = useCallback(() => {
    if (markerRafRef.current) return;
    markerRafRef.current = requestAnimationFrame(() => {
      markerRafRef.current = 0;
      updateActiveMarker();
    });
  }, [updateActiveMarker]);

  // Compute scroll-rail markers: every message becomes a dash positioned by its scroll offset
  const computeScrollMarkers = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll('[data-msg-id]'));
    markerNodesRef.current = nodes;
    const range = el.scrollHeight - el.clientHeight;
    if (range <= 8 || nodes.length < 2) {
      setScrollTicks((prev) => (prev.length === 0 ? prev : []));
      updateActiveMarker();
      return;
    }
    const next = nodes.map((node) => ({
      id: node.getAttribute('data-msg-id'),
      role: node.getAttribute('data-msg-role') || 'assistant',
      index: Number(node.getAttribute('data-msg-index') || 0),
      top: node.offsetTop,
      pct: Math.max(0, Math.min(1, (node.offsetTop - SCROLL_MARKER_OFFSET) / range))
    }));
    setScrollTicks((prev) => {
      if (
        prev.length === next.length &&
        prev.every((tick, i) => tick.id === next[i].id && Math.abs(tick.pct - next[i].pct) < 0.002)
      ) {
        return prev;
      }
      return next;
    });
    updateActiveMarker();
  }, [updateActiveMarker]);

  // Keep markers aligned with content growth (streaming) and viewport resizing
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return undefined;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        computeScrollMarkers();
      });
    };
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(el);
      const content = el.firstElementChild;
      if (content) observer.observe(content);
    }
    window.addEventListener('resize', schedule);
    computeScrollMarkers();
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [computeScrollMarkers, messages.length, conversation?.id]);

  // Reset the collapsed context bar when switching conversations
  useEffect(() => {
    setContextBarCollapsed(false);
  }, [conversation?.id]);

  // Monitor user scroll position & update auto-follow
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 35;
    setIsNearBottom(nearBottom);

    // Only an actual upward scroll collapses the bar (keeps the initial load untouched)
    const prevScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    const scrolledUp = el.scrollTop < prevScrollTop - 1;

    // Collapse the context token bar while browsing history, restore it near the latest message
    if (scrolledUp && distanceFromBottom > CONTEXT_COLLAPSE_DISTANCE) {
      setContextBarCollapsed(true);
    } else if (distanceFromBottom <= CONTEXT_EXPAND_DISTANCE) {
      setContextBarCollapsed(false);
    }

    scheduleActiveMarkerUpdate();

    if (isProgrammaticScrollRef.current) {
      if (distanceFromBottom <= 15) {
        isProgrammaticScrollRef.current = false;
        autoFollowRef.current = true;
      }
      return;
    }

    if (nearBottom) {
      autoFollowRef.current = true;
    } else if (distanceFromBottom > 60) {
      autoFollowRef.current = false;
    }
  }, [scheduleActiveMarkerUpdate]);

  // Gesture handling: Touch start
  const handleTouchStart = useCallback((e) => {
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
    }
  }, []);

  // Gesture handling: Touch move (detect upward scroll gesture or horizontal table swipe)
  const handleTouchMove = useCallback((e) => {
    if (!e.touches || !e.touches[0] || touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const deltaY = currentY - touchStartYRef.current; // Positive = pulling down to view older messages
    const deltaX = currentX - (touchStartXRef.current ?? currentX);

    const el = scrollContainerRef.current;
    if (el) {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if ((deltaY > 8 && distanceFromBottom > 40) || (Math.abs(deltaX) > 10 && distanceFromBottom > 20)) {
        autoFollowRef.current = false;
        setIsNearBottom(false);
      }
    }
  }, []);

  // Wheel handling: Detect wheeling up
  const handleWheel = useCallback((e) => {
    if (e.deltaY < -2) { // Scrolling up
      const el = scrollContainerRef.current;
      if (el) {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom > 40) {
          autoFollowRef.current = false;
          setIsNearBottom(false);
        }
      }
    }
  }, []);

  // RAF-throttled auto follow bottom during streaming
  useEffect(() => {
    if (!autoFollowRef.current || isProgrammaticScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    if (!rafPendingRef.current) {
      rafPendingRef.current = true;
      requestAnimationFrame(() => {
        rafPendingRef.current = false;
        if (autoFollowRef.current && el && !isProgrammaticScrollRef.current) {
          el.scrollTop = el.scrollHeight - el.clientHeight;
        }
      });
    }
  }, [messages, isStreaming, liveStatus]);

  // Smooth scroll to bottom handler (Floating button)
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    setIsNearBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });

    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      autoFollowRef.current = true;
    }, 350);
  }, []);

  // Wrap send to immediately re-enable auto follow
  const handleSendWrapped = useCallback(() => {
    autoFollowRef.current = true;
    isProgrammaticScrollRef.current = false;
    setIsNearBottom(true);
    onSend();
  }, [onSend]);

  // Jump to a message by clicking its marker on the scroll rail
  const scrollToMessage = useCallback((top) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    autoFollowRef.current = false;
    isProgrammaticScrollRef.current = true;
    setIsNearBottom(false);
    el.scrollTo({ top: Math.max(0, top - SCROLL_MARKER_OFFSET), behavior: 'smooth' });
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      const current = scrollContainerRef.current;
      // Resume auto-follow when the jump target is (nearly) the latest message
      if (current && current.scrollHeight - current.scrollTop - current.clientHeight <= 35) {
        autoFollowRef.current = true;
        setIsNearBottom(true);
      }
    }, 450);
  }, []);

  const shortModelName = currentModelId
    ? (currentModelId.includes('/') ? currentModelId.split('/').pop() : currentModelId)
    : t('chat.selectModel');

  const {
    usedTokens = 0,
    maxTokens = 32768,
    threshold = 26214,
    isNearLimit = false,
    isOverThreshold = false
  } = contextStats;

  // Context usage ratio + colour state for the collapsed indicator
  const contextUsagePct = maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : 0;
  const contextBarColorClass = isCompressing
    ? 'bg-emerald-400 animate-pulse'
    : isOverThreshold
      ? 'bg-rose-400'
      : isNearLimit
        ? 'bg-amber-400'
        : 'bg-emerald-400/80';

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0f17] text-slate-100 overflow-hidden relative">
      {/* Top App Header */}
      <header className="flex items-center justify-between px-3 py-2 bg-[#0e1420]/95 border-b border-slate-800/80 backdrop-blur-md z-10 safe-area-top">
        <button
          onClick={onOpenDrawer}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title={t('app.history')}
        >
          <Menu size={19} />
        </button>

        {/* Model Selector Trigger */}
        <button
          onClick={onOpenModelSelector}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 transition-all max-w-[55%] active:scale-95 shadow-sm"
        >
          <Bot size={14} className="text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200 truncate">{shortModelName}</span>
          <ChevronDown size={13} className="text-slate-400 shrink-0" />
        </button>

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title={t('app.settings')}
        >
          <Settings size={19} />
        </button>
      </header>

      {/* Context Usage Bar & Dynamic 80% Compression Indicator (collapses when scrolling up) */}
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          contextBarCollapsed ? 'max-h-0 opacity-0' : 'max-h-16 opacity-100'
        }`}
        aria-hidden={contextBarCollapsed}
      >
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#0b101a] border-b border-slate-800/60 text-[11px] text-slate-400 select-none">
          <div className="flex items-center gap-1.5 truncate">
            <Zap size={11} className={isNearLimit ? "text-amber-400" : "text-emerald-400"} />
            <span className="font-mono">
              Context: {formatTokenNumber(usedTokens)} / {formatTokenNumber(maxTokens)}
            </span>
            {isCompressing ? (
              <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px] animate-pulse">
                <Loader2 size={10} className="animate-spin" />
                <span>壓縮中…</span>
              </span>
            ) : isOverThreshold ? (
              <span className="flex items-center gap-1 text-rose-400 bg-rose-950/60 border border-rose-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px]">
                <AlertCircle size={10} />
                <span>達 80% 上限</span>
              </span>
            ) : isNearLimit ? (
              <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px]">
                <AlertCircle size={10} />
                <span>接近壓縮門檻</span>
              </span>
            ) : null}
          </div>

          {/* Manual Compress Context Button */}
          {messages.length >= 3 && (
            <button
              type="button"
              onClick={onCompressContext}
              disabled={isCompressing || isStreaming}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white transition-all text-[11px] disabled:opacity-40 active:scale-95 border border-slate-700/60 shrink-0 whitespace-nowrap"
              title="手動將歷史對話壓縮為結構化摘要"
            >
              {isCompressing ? (
                <Loader2 size={11} className="animate-spin text-emerald-400 shrink-0" />
              ) : (
                <Minimize2 size={11} className="text-emerald-400 shrink-0" />
              )}
              <span className="hidden sm:inline">壓縮上下文</span>
            </button>
          )}
        </div>
      </div>

      {/* Compression Toast Banner */}
      {compressionToast && (
        <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-3 py-1.5 text-center text-xs text-emerald-200 font-medium animate-fade-in flex items-center justify-center gap-1.5">
          <Sparkles size={13} className="text-emerald-400" />
          <span>{compressionToast}</span>
        </div>
      )}

      {/* Messages List Area with Gesture-Aware Scroll Controller */}
      <div className="flex-1 min-h-0 relative">
        <main
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onWheel={handleWheel}
          className="h-full chat-scroll-container p-2 sm:p-4 space-y-2 max-w-full relative"
          style={{ scrollBehavior: 'auto', overflowAnchor: 'auto' }}
        >
          <div key={conversation?.id || 'empty_conv'} className="animate-chat-switch space-y-2">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-16 text-slate-500 gap-3">
                {conversationType === 'meihua' ? (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 text-2xl shadow-lg shadow-rose-950/30">
                      🌸
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base">{t('meihua.welcome', '🌸 梅花易數占卜')}</h3>
                      <p className="text-xs text-slate-400 mt-1.5 max-w-xs leading-relaxed">
                        {t('meihua.welcomeDesc', '請描述您欲占問之事，並選擇起卦方式')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/30">
                      <Bot size={28} />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base">NvidiaPatch Chat</h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                        支援本機技能與即時網路搜尋。請輸入訊息開始對話。
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              messages
                .filter((msg, idx, arr) => {
                  if (msg.role === 'system') return false;
                  // Filter out raw protocol tool messages from visual timeline
                  if (msg.role === 'tool') return false;
                  // Filter out empty intermediate assistant tool-call headers EXCEPT when actively streaming current turn
                  if (msg.role === 'assistant' && !msg.content?.trim() && !msg.thinkingContent?.trim() && (!msg.toolExecutions || msg.toolExecutions.length === 0)) {
                    if (isStreaming && idx === arr.length - 1) {
                      return true;
                    }
                    return false;
                  }
                  return true;
                })
                .map((msg, idx, arr) => (
                  <React.Fragment key={msg.id || idx}>
                    {/* 生成等待廣告：插在前一則泡泡與生成中助理泡泡之間（inline，不懸浮）。
                        不帶 data-msg-id，不會變成右側位置標籤的刻度。 */}
                    {isStreaming && idx === arr.length - 1 && (
                      <InlineWaitingAd isStreaming={isStreaming} />
                    )}
                    <div
                      data-msg-id={msg.id || `msg-${idx}`}
                      data-msg-role={msg.role}
                      data-msg-index={idx}
                      className="chat-message-anchor"
                      style={{ overflowAnchor: 'auto' }}
                    >
                      <MessageBubble
                        message={msg}
                        isLast={idx === arr.length - 1}
                        isStreaming={isStreaming}
                        isReasoningActive={isReasoningActive}
                        liveStatus={idx === arr.length - 1 ? liveStatus : null}
                        onRegenerate={onRegenerate}
                        onDelete={onDeleteMessage}
                        onEdit={onEditMessage}
                      />
                    </div>
                  </React.Fragment>
                ))
            )}
            <div ref={messagesEndRef} style={{ overflowAnchor: 'none' }} />
          </div>
        </main>

        {/* Collapsed context indicator: slim usage bar, tap to restore the full context bar */}
        {contextBarCollapsed && (
          <button
            type="button"
            onClick={() => setContextBarCollapsed(false)}
            className="absolute top-0 left-0 right-0 z-20 h-2 flex items-start"
            title={t('chat.showContextUsage', '顯示 Context 用量')}
            aria-label={t('chat.showContextUsage', '顯示 Context 用量')}
          >
            <span className="block h-[2px] w-full bg-slate-800/80" />
            <span
              className={`absolute top-0 left-0 h-[2px] rounded-r-full transition-[width] duration-300 ${contextBarColorClass}`}
              style={{ width: `${contextUsagePct}%` }}
            />
          </button>
        )}

        {/* Scroll rail: each dash marks a message position, tap to jump */}
        {scrollTicks.length > 1 && (
          <div
            className="absolute inset-y-0 right-0 w-4 z-10 pointer-events-none select-none"
            role="group"
            aria-label={t('chat.scrollMarkers', '對話捲軸位置標記')}
          >
            {scrollTicks.map((tick) => {
              const isActive = tick.id === activeTickId;
              const isUserTurn = tick.role === 'user';
              return (
                <button
                  key={tick.id}
                  type="button"
                  onClick={() => scrollToMessage(tick.top)}
                  title={t('chat.jumpToMessage', { index: tick.index + 1 })}
                  aria-label={t('chat.jumpToMessage', { index: tick.index + 1 })}
                  className="pointer-events-auto absolute right-[6px] h-3 flex items-center justify-end"
                  style={{ top: `calc(${(tick.pct * 100).toFixed(2)}% - 6px)` }}
                >
                  <span
                    className={`block h-[2px] rounded-full transition-all duration-150 ${
                      isUserTurn ? 'bg-emerald-400/80' : 'bg-slate-400/45'
                    } ${isActive ? 'w-2.5 opacity-100' : 'w-1.5 opacity-70'}`}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {!isNearBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute right-4 bottom-20 z-20 p-2.5 rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-950/60 hover:bg-emerald-400 active:scale-95 transition-all animate-fade-in flex items-center justify-center"
          title="回到底部"
        >
          <ArrowDown size={16} />
        </button>
      )}

      {/* Bottom Sticky Chat Input */}
      {conversationType === 'meihua' && (
        <MeihuaActionBar
          onRandomCast={onRandomCast}
          onShowHelp={onShowHelp}
        />
      )}
      <ChatInput
        input={input}
        setInput={setInput}
        isStreaming={isStreaming}
        onSend={handleSendWrapped}
        onStop={onStop}
        availableSkills={availableSkills}
        selectedSkillIds={selectedSkillIds}
        onToggleSkill={onToggleSkill}
        hideSkillsSelector={conversationType === 'meihua'}
        attachedImages={attachedImages}
        onAddImages={onAddImages}
        onRemoveImage={onRemoveImage}
        onClearImages={onClearImages}
        disabled={!currentModelId}
      />
    </div>
  );
}
