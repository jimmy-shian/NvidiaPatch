import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Settings, ChevronDown, Bot, Sparkles, Minimize2, Loader2, Zap, AlertCircle, ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
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
  onToggleSkill
}) {
  const { t } = useTranslation();
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const autoFollowRef = useRef(true);
  const touchStartYRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const rafPendingRef = useRef(false);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Monitor user scroll position & update auto-follow
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 35;
    setIsNearBottom(nearBottom);

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
  }, []);

  // Gesture handling: Touch start
  const handleTouchStart = useCallback((e) => {
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
    }
  }, []);

  // Gesture handling: Touch move (detect upward scroll gesture)
  const handleTouchMove = useCallback((e) => {
    if (!e.touches || !e.touches[0] || touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartYRef.current; // Positive = pulling down to view older messages

    const el = scrollContainerRef.current;
    if (el) {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (deltaY > 8 && distanceFromBottom > 40) {
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

      {/* Context Usage Bar & Dynamic 80% Compression Indicator */}
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
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white transition-all text-[11px] disabled:opacity-40 active:scale-95 border border-slate-700/60"
            title="手動將歷史對話壓縮為結構化摘要"
          >
            {isCompressing ? (
              <Loader2 size={11} className="animate-spin text-emerald-400" />
            ) : (
              <Minimize2 size={11} className="text-emerald-400" />
            )}
            <span>壓縮上下文</span>
          </button>
        )}
      </div>

      {/* Compression Toast Banner */}
      {compressionToast && (
        <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-3 py-1.5 text-center text-xs text-emerald-200 font-medium animate-fade-in flex items-center justify-center gap-1.5">
          <Sparkles size={13} className="text-emerald-400" />
          <span>{compressionToast}</span>
        </div>
      )}

      {/* Messages List Area with Gesture-Aware Scroll Controller */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onWheel={handleWheel}
        className="flex-1 chat-scroll-container p-2 sm:p-4 space-y-2 max-w-full relative"
        style={{ scrollBehavior: 'auto', overflowAnchor: 'auto' }}
      >
        <div key={conversation?.id || 'empty_conv'} className="animate-chat-switch space-y-2">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-16 text-slate-500 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/30">
                <Bot size={28} />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">NvidiaPatch Chat</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                  支援本機技能與即時網路搜尋。請輸入訊息開始對話。
                </p>
              </div>
            </div>
          ) : (
            messages
              .filter(msg => msg.role !== 'system')
              .map((msg, idx) => (
                <div key={msg.id || idx} className="chat-message-anchor" style={{ overflowAnchor: 'auto' }}>
                  <MessageBubble
                    message={msg}
                    isLast={idx === messages.length - 1}
                    isStreaming={isStreaming}
                    isReasoningActive={isReasoningActive}
                    liveStatus={idx === messages.length - 1 ? liveStatus : null}
                    onRegenerate={onRegenerate}
                    onDelete={onDeleteMessage}
                    onEdit={onEditMessage}
                  />
                </div>
              ))
          )}
          <div ref={messagesEndRef} style={{ overflowAnchor: 'none' }} />
        </div>
      </main>

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
      <ChatInput
        input={input}
        setInput={setInput}
        isStreaming={isStreaming}
        onSend={handleSendWrapped}
        onStop={onStop}
        availableSkills={availableSkills}
        selectedSkillIds={selectedSkillIds}
        onToggleSkill={onToggleSkill}
        disabled={!currentModelId}
      />
    </div>
  );
}
