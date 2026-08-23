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

  useEffect(() => {
    if (isStreaming && isReasoningActive && !userToggled) {
      setExpanded(true);
    } else if (!isReasoningActive && !userToggled && !isStreaming) {
      setExpanded(false);
    }
  }, [isStreaming, isReasoningActive, userToggled]);

  // Auto scroll reasoning box to bottom as thoughts stream in
  useEffect(() => {
    if (expanded && isReasoningActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingContent, expanded, isReasoningActive]);

  if (!thinkingContent && !isStreaming) return null;

  const isThinkingNow = isStreaming && isReasoningActive;

  return (
    <div className="my-2 rounded-2xl border border-slate-800/90 bg-slate-950/80 overflow-hidden backdrop-blur-md transition-all shadow-sm">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setExpanded(prev => !prev);
        }}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-slate-900/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Brain size={14} className={isThinkingNow ? "animate-pulse text-emerald-400" : "text-slate-400"} />
          {isThinkingNow ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Loader2 size={12} className="animate-spin text-emerald-400" />
              <span>思考推理中…</span>
            </span>
          ) : (
            <span className="text-slate-300 font-medium flex items-center gap-1">
              <span>已完成思考</span>
              <Sparkles size={11} className="text-emerald-400/80" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <span>{expanded ? '收合' : '展開'}</span>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
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
              <Loader2 size={12} className="animate-spin text-emerald-400" />
              <span>正在分析問題脈絡與邏輯構思中...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
