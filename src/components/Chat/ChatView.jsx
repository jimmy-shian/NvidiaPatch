import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Settings, ChevronDown, Bot, Sparkles, MessageSquare, Minimize2, Loader2, Zap, AlertCircle } from 'lucide-react';
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
  contextStats = { usedTokens: 0, maxTokens: 32768, isNearLimit: false },
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

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const shortModelName = currentModelId
    ? (currentModelId.includes('/') ? currentModelId.split('/').pop() : currentModelId)
    : t('chat.selectModel');

  const { usedTokens = 0, maxTokens = 32768, isNearLimit = false, isOverThreshold = false } = contextStats;

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0f17] text-slate-100 overflow-hidden">
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

      {/* Context Usage Bar & Manual Compress Header Toolbar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#0b101a] border-b border-slate-800/60 text-[11px] text-slate-400 select-none">
        {/* Token Counter & Warning Badge */}
        <div className="flex items-center gap-1.5 truncate">
          <Zap size={11} className={isNearLimit ? "text-amber-400" : "text-emerald-400"} />
          <span className="font-mono">
            Context: {formatTokenNumber(usedTokens)} / {formatTokenNumber(maxTokens)}
          </span>
          {isCompressing ? (
            <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px] animate-pulse">
              <Loader2 size={10} className="animate-spin" />
              <span>正在壓縮…</span>
            </span>
          ) : isNearLimit ? (
            <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.2 rounded-md font-sans text-[10px]">
              <AlertCircle size={10} />
              <span>接近自動壓縮</span>
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
            title="手動將較早對話壓縮為結構化摘要"
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

      {/* Messages List Area */}
      <main className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12 text-slate-500 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/30">
              <Bot size={28} />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">NvidiaPatch Chat</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                Local-first 獨立 AI 對話與 Agent。請先選取技能或模型開始對話。
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id || idx}
              message={msg}
              isLast={idx === messages.length - 1}
              isStreaming={isStreaming}
              isReasoningActive={isReasoningActive}
              onRegenerate={onRegenerate}
              onDelete={onDeleteMessage}
              onEdit={onEditMessage}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Bottom Sticky Chat Input */}
      <ChatInput
        input={input}
        setInput={setInput}
        isStreaming={isStreaming}
        onSend={onSend}
        onStop={onStop}
        availableSkills={availableSkills}
        selectedSkillIds={selectedSkillIds}
        onToggleSkill={onToggleSkill}
        disabled={!currentModelId}
      />
    </div>
  );
}
