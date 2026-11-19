import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Settings, ChevronDown, Bot, Sparkles, Minimize2, Loader2, Zap, AlertCircle, ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import InlineWaitingAd from './InlineWaitingAd';
import ChatInput from './ChatInput';
import MeihuaActionBar from './MeihuaActionBar';
import {
  CONTEXT_COLLAPSE_DISTANCE,
  CONTEXT_EXPAND_DISTANCE,
  nextContextBarCollapsed
} from './contextBarLogic';
import {
  SNAP_ANCHOR_OFFSET,
  createInitialSnapState,
  startNewScrollGesture,
  completeSnapAnimation,
  evaluateScrollSnap,
  evaluateIdleSnap
} from './scrollSnapLogic';
import { toggleOptionInInput } from '../../core/utils/optionsParser';
import { formatTokenNumber } from '../../core/context/modelLimits';

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
  const lastScrollTopRef = useRef(0);
  const snapStateRef = useRef(createInitialSnapState());
  const snapSettleTimerRef = useRef(null);
  const idleSnapTimerRef = useRef(null);
  const lastWheelTimeRef = useRef(0);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [contextBarCollapsed, setContextBarCollapsed] = useState(false);
  // Context 列本體與高度追蹤：收合／展開會改變訊息視窗高度，必須做捲動補償
  const contextBarRef = useRef(null);
  const contextBarHeightRef = useRef(null);
  const lastConvIdRef = useRef(conversation?.id);

  const clearSnapTimers = useCallback(() => {
    if (snapSettleTimerRef.current) {
      clearTimeout(snapSettleTimerRef.current);
      snapSettleTimerRef.current = null;
    }
    if (idleSnapTimerRef.current) {
      clearTimeout(idleSnapTimerRef.current);
      idleSnapTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearSnapTimers();
    };
  }, [clearSnapTimers]);

  // Reset the collapsed context bar and snap state when switching conversations
  useEffect(() => {
    setContextBarCollapsed(false);
    clearSnapTimers();
    snapStateRef.current = createInitialSnapState();
    lastScrollTopRef.current = 0;
  }, [conversation?.id, clearSnapTimers]);

  // Context bar collapse/expand resizes the message viewport by the bar height.
  // Compensate scrollTop with the same delta (in the same frame, before paint) so the
  // reading position stays visually stable — otherwise the jump fights CSS scroll
  // anchoring, shifts the scroll-rail mapping, and can clamp-scroll near the bottom
  // into a collapse/expand oscillation.
  useLayoutEffect(() => {
    const bar = contextBarRef.current;
    const scroller = scrollContainerRef.current;
    if (!bar || !scroller) return;
    const convChanged = lastConvIdRef.current !== conversation?.id;
    lastConvIdRef.current = conversation?.id;
    const prevHeight = contextBarHeightRef.current;
    const height = bar.offsetHeight;
    contextBarHeightRef.current = height;
    // Skip on mount, conversation switches, and no-op height changes
    if (convChanged || prevHeight === null || prevHeight === height) return;
    const delta = height - prevHeight; // negative on collapse, positive on expand
    scroller.scrollTop += delta;
    lastScrollTopRef.current = scroller.scrollTop;
  }, [contextBarCollapsed, conversation?.id]);

  const collectSnapAnchors = useCallback((scroller) => {
    if (!scroller) return [];
    const nodes = scroller.querySelectorAll('.chat-message-anchor');
    const anchors = [];
    nodes.forEach((node, idx) => {
      anchors.push({
        id: node.getAttribute('data-msg-id') || `msg-${idx}`,
        offsetTop: node.offsetTop,
        targetTop: Math.max(0, node.offsetTop - SNAP_ANCHOR_OFFSET)
      });
    });
    return anchors;
  }, []);

  const triggerSnapToTarget = useCallback((scroller, snapTarget) => {
    if (!scroller || !snapTarget) return;
    if (snapSettleTimerRef.current) {
      clearTimeout(snapSettleTimerRef.current);
      snapSettleTimerRef.current = null;
    }
    scroller.scrollTo({ top: snapTarget.targetTop, behavior: 'smooth' });
    snapSettleTimerRef.current = setTimeout(() => {
      snapSettleTimerRef.current = null;
      snapStateRef.current = completeSnapAnimation(snapStateRef.current);
    }, 220);
  }, []);

  // Monitor user scroll position & update auto-follow
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    if (idleSnapTimerRef.current) {
      clearTimeout(idleSnapTimerRef.current);
      idleSnapTimerRef.current = null;
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 35;
    setIsNearBottom(nearBottom);

    const prevScrollTop = lastScrollTopRef.current;
    const currScrollTop = el.scrollTop;
    lastScrollTopRef.current = currScrollTop;

    // Collapse the context token bar while browsing history, restore it near the latest
    // message. Programmatic scrolls (scroll-to-bottom) never toggle here:
    // the layout compensation writes scrollTop and would cancel the running smooth scroll.
    setContextBarCollapsed((prev) => nextContextBarCollapsed({
      collapsed: prev,
      scrollTop: currScrollTop,
      prevScrollTop,
      distanceFromBottom,
      isProgrammatic: isProgrammaticScrollRef.current
    }));

    if (isProgrammaticScrollRef.current) {
      if (distanceFromBottom <= 15) {
        isProgrammaticScrollRef.current = false;
        autoFollowRef.current = true;
      }
      return;
    }

    if (nearBottom) {
      if (touchStartYRef.current === null) {
        autoFollowRef.current = true;
      }
    } else if (distanceFromBottom > 35) {
      autoFollowRef.current = false;
    }

    // Evaluate snap state machine (unlocks when leaving release zone, snaps when crossing/entering trigger zone)
    const anchors = collectSnapAnchors(el);
    const { nextState, snapTarget } = evaluateScrollSnap({
      state: snapStateRef.current,
      prevScrollTop,
      currScrollTop,
      distanceFromBottom,
      anchors,
      isStreaming: isStreamingRef.current,
      isProgrammatic: isProgrammaticScrollRef.current,
      isTouchActive: touchStartYRef.current !== null
    });
    snapStateRef.current = nextState;

    if (snapTarget) {
      triggerSnapToTarget(el, snapTarget);
    }
  }, [collectSnapAnchors, triggerSnapToTarget]);

  // Gesture handling: Touch start
  const handleTouchStart = useCallback((e) => {
    clearSnapTimers();
    const el = scrollContainerRef.current;
    snapStateRef.current = startNewScrollGesture(snapStateRef.current, el ? el.scrollTop : 0);
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
    }
  }, [clearSnapTimers]);

  // Gesture handling: Touch move (detect upward scroll gesture or horizontal table swipe)
  const handleTouchMove = useCallback((e) => {
    if (!e.touches || !e.touches[0] || touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const deltaY = currentY - touchStartYRef.current; // Positive = pulling down to view older messages
    const deltaX = currentX - (touchStartXRef.current ?? currentX);

    // Any clear user gesture pulling down to read older history immediately disables auto-follow
    if (deltaY > 3 || (Math.abs(deltaX) > 10 && deltaY >= 0)) {
      autoFollowRef.current = false;
      setIsNearBottom(false);
    }
  }, []);

  // Gesture handling: Touch end / cancel
  const handleTouchEnd = useCallback(() => {
    touchStartYRef.current = null;
    touchStartXRef.current = null;
    // Fallback for slow drag stopping inside trigger zone with no inertia scroll frames
    if (idleSnapTimerRef.current) {
      clearTimeout(idleSnapTimerRef.current);
    }
    idleSnapTimerRef.current = setTimeout(() => {
      idleSnapTimerRef.current = null;
      const el = scrollContainerRef.current;
      if (!el || touchStartYRef.current !== null) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const anchors = collectSnapAnchors(el);
      const { nextState, snapTarget } = evaluateIdleSnap({
        state: snapStateRef.current,
        currScrollTop: el.scrollTop,
        distanceFromBottom,
        anchors,
        isStreaming: isStreamingRef.current,
        isProgrammatic: isProgrammaticScrollRef.current
      });
      snapStateRef.current = nextState;
      if (snapTarget) {
        triggerSnapToTarget(el, snapTarget);
      }
    }, 80);
  }, [collectSnapAnchors, triggerSnapToTarget]);

  // Wheel handling: Detect wheeling up & track wheel gesture boundary
  const handleWheel = useCallback((e) => {
    const now = Date.now();
    if (now - lastWheelTimeRef.current > 180) {
      const el = scrollContainerRef.current;
      snapStateRef.current = startNewScrollGesture(snapStateRef.current, el ? el.scrollTop : 0);
    }
    lastWheelTimeRef.current = now;

    if (e.deltaY < 0) { // Scrolling up to read history
      autoFollowRef.current = false;
      setIsNearBottom(false);
    }
  }, []);

  // RAF-throttled auto follow bottom during streaming
  useEffect(() => {
    // Prohibit auto-scrolling if user disabled follow, programmatic jump is running, or user finger is on screen
    if (!autoFollowRef.current || isProgrammaticScrollRef.current || touchStartYRef.current !== null) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    if (!rafPendingRef.current) {
      rafPendingRef.current = true;
      requestAnimationFrame(() => {
        rafPendingRef.current = false;
        // Verify user is still near bottom before jumping, avoiding fighting active user reading
        if (autoFollowRef.current && el && !isProgrammaticScrollRef.current && touchStartYRef.current === null) {
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (distanceFromBottom <= 50) {
            el.scrollTop = el.scrollHeight - el.clientHeight;
          }
        }
      });
    }
  }, [messages, isStreaming, liveStatus]);

  // Smooth scroll to bottom handler (Floating button)
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    clearSnapTimers();
    snapStateRef.current = createInitialSnapState();
    isProgrammaticScrollRef.current = true;
    setIsNearBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });

    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      autoFollowRef.current = true;
      // Landed at the latest message: restore the context bar (toggling was suppressed
      // during the jump so the smooth scroll would not be cancelled)
      const current = scrollContainerRef.current;
      if (current && current.scrollHeight - current.scrollTop - current.clientHeight <= CONTEXT_EXPAND_DISTANCE) {
        setContextBarCollapsed(false);
      }
    }, 350);
  }, []);

  // Wrap send to immediately re-enable auto follow
  const handleSendWrapped = useCallback((customText = null) => {
    const safeCustomText = typeof customText === 'string' ? customText : null;
    autoFollowRef.current = true;
    isProgrammaticScrollRef.current = false;
    setIsNearBottom(true);
    onSend(safeCustomText);
  }, [onSend]);

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
      <header className="flex items-center justify-between gap-2 px-3 py-2 bg-[#0e1420]/95 border-b border-slate-800/80 backdrop-blur-md z-10 safe-area-top">
        <button
          onClick={onOpenDrawer}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          title={t('app.history')}
        >
          <Menu size={19} />
        </button>

        {/* Model Selector Trigger */}
        <button
          onClick={onOpenModelSelector}
          className="flex-1 min-w-0 max-w-[72%] sm:max-w-sm mx-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 transition-all active:scale-95 shadow-sm"
        >
          <Bot size={14} className="text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200 truncate">{shortModelName}</span>
          <ChevronDown size={13} className="text-slate-400 shrink-0" />
        </button>

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          title={t('app.settings')}
        >
          <Settings size={19} />
        </button>
      </header>

      {/* Context Usage Bar & Dynamic 80% Compression Indicator (collapses when scrolling up).
          Height toggles instantly (opacity-only transition): the layout effect compensates
          scrollTop with the height delta, which only works on an instant height swap. */}
      <div
        ref={contextBarRef}
        className={`overflow-hidden transition-opacity duration-150 ${
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
                <span>{t('chat.compressing', '壓縮中…')}</span>
              </span>
            ) : isOverThreshold ? (
              <span className="flex items-center gap-1 text-rose-400 bg-rose-950/60 border border-rose-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px]">
                <AlertCircle size={10} />
                <span>{t('chat.limit80', '達 80% 上限')}</span>
              </span>
            ) : isNearLimit ? (
              <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px]">
                <AlertCircle size={10} />
                <span>{t('chat.nearLimit', '接近壓縮門檻')}</span>
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
              title={t('chat.compressHint', '將歷史對話壓縮為摘要')}
            >
              {isCompressing ? (
                <Loader2 size={11} className="animate-spin text-emerald-400 shrink-0" />
              ) : (
                <Minimize2 size={11} className="text-emerald-400 shrink-0" />
              )}
              <span className="hidden sm:inline">{t('chat.compressContext', '壓縮上下文')}</span>
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
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onWheel={handleWheel}
          className="h-full chat-scroll-container p-2 sm:p-4 pb-8 space-y-2 max-w-full relative"
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
                        {t('meihua.welcomeDesc', '描述占問事項並選擇起卦方式')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/30">
                      <Bot size={28} />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base">{t('settings.about.title', 'NvidiaPatch Chat')}</h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                        {t('chat.welcomeDesc', '輸入訊息開始對話。')}
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
                  <div
                    key={msg.id || idx}
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
                      currentInput={input}
                      onSelectOption={(opt) => {
                        const val = opt?.label || opt?.value;
                        if (!val) return;
                        let toggleOutcome = { added: false, hasRequirement: false };
                        setInput(prev => {
                          toggleOutcome = toggleOptionInInput(prev, opt);
                          return toggleOutcome.nextInput;
                        });
                        setTimeout(() => {
                          if (!toggleOutcome.added) return;
                          const textarea = document.querySelector('textarea');
                          if (textarea) {
                            textarea.focus();
                            const len = toggleOutcome.hasRequirement
                              ? Math.max(0, textarea.value.length - 1)
                              : textarea.value.length;
                            textarea.setSelectionRange(len, len);
                          }
                        }, 50);
                      }}
                    />
                  </div>
                ))
            )}
            <InlineWaitingAd isStreaming={isStreaming} />
            <div ref={messagesEndRef} className="h-6 w-full shrink-0" style={{ overflowAnchor: 'none' }} />
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

        {/* Floating Scroll to Bottom Button (scoped inside message viewport so it never overlaps bottom skills bar) */}
        {!isNearBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute right-3 bottom-3 z-20 p-2.5 rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-950/60 hover:bg-emerald-400 active:scale-95 transition-all animate-fade-in flex items-center justify-center"
            title={t('chat.scrollToBottom', '回到底部')}
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

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
