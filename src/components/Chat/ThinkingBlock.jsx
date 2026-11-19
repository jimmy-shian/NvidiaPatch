import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import MarkdownRenderer from '../shared/MarkdownRenderer';

export default function ThinkingBlock({
  thinkingContent = '',
  isStreaming = false,
  isReasoningActive = false
}) {
  const { t } = useTranslation();
  // Auto expand while reasoning is actively streaming live thoughts; auto-collapse when answering begins.
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const scrollRef = useRef(null);

  const hasThinking = Boolean(thinkingContent && thinkingContent.trim().length > 0);
  const isThinkingNow = isStreaming && isReasoningActive;
  const thinkingCharCount = thinkingContent ? thinkingContent.trim().length : 0;

  // 只有真的收到思考內容才自動展開；尚未有內容時維持收合的單行狀態列，
  // 避免出現「空殼思考框 + 額外載入動畫」。
  useEffect(() => {
    if (userToggled) return;
    setExpanded(isThinkingNow && hasThinking);
  }, [isThinkingNow, hasThinking, userToggled]);

  // Auto scroll reasoning box to bottom as thoughts stream in
  useEffect(() => {
    if (expanded && isThinkingNow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingContent, expanded, isThinkingNow]);

  // If no thinking content exists and we're not actively reasoning, do not render thinking box
  if (!hasThinking && !isThinkingNow) return null;

  return (
    <div className="my-2 rounded-2xl border border-slate-800/90 bg-slate-950/80 overflow-hidden backdrop-blur-md transition-all shadow-sm">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setExpanded(prev => !prev);
        }}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-slate-900/60 transition-colors"
      >
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 text-xs font-semibold min-w-0 flex-1">
          <Brain size={14} className={`shrink-0 ${isThinkingNow ? "text-emerald-400" : "text-slate-400"}`} />
          {isThinkingNow ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium min-w-0">
              <Loader2 size={12} className="animate-spin text-emerald-400 shrink-0" />
              <span className="whitespace-nowrap">{t('chat.thinkingActive', '思考中…')}</span>
            </span>
          ) : (
            <span className="text-slate-300 font-medium flex items-center flex-wrap gap-1.5 min-w-0">
              <span className="whitespace-nowrap shrink-0">{t('chat.thinkingDone', '已完成思考')}</span>
              {thinkingCharCount > 0 && (
                <span className="text-[10px] font-mono text-emerald-400/90 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 rounded-md whitespace-nowrap shrink-0">
                  {t('chat.thinkingChars', `${thinkingCharCount} 字`, { count: thinkingCharCount })}
                </span>
              )}
              <Sparkles size={11} className="text-emerald-400/80 shrink-0 hidden sm:inline" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap shrink-0">
          <span>{expanded ? t('chat.collapse', '收合') : t('chat.expand', '展開')}</span>
          {expanded ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
        </div>
      </button>

      {/* Expanded Reasoning Live Stream */}
      {expanded && (
        <div
          ref={scrollRef}
          className="px-3.5 pb-3 pt-1.5 border-t border-slate-800/60 text-xs text-slate-300 bg-black/40 max-h-[50vh] overflow-y-auto leading-relaxed font-sans scrollbar-thin"
        >
          {thinkingContent ? (
            <div className="relative">
              <MarkdownRenderer content={thinkingContent} />
              {isThinkingNow && (
                <span className="inline-block w-1.5 h-3.5 ml-1 bg-emerald-400 animate-pulse align-middle" />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-400 py-1 text-[11px]">
              <span>{t('chat.thinkingActive', '思考中…')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
