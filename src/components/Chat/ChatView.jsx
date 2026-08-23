import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Settings, ChevronDown, Bot, Sparkles, MessageSquare } from 'lucide-react';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';

export default function ChatView({
  conversation,
  messages = [],
  input,
  setInput,
  isStreaming,
  isReasoningActive,
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

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0f17] text-slate-100 overflow-hidden">
      {/* Top App Header */}
      <header className="flex items-center justify-between px-3 py-2.5 bg-[#0e1420]/90 border-b border-slate-800/80 backdrop-blur-md z-10 safe-area-top">
        <button
          onClick={onOpenDrawer}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title={t('app.history')}
        >
          <Menu size={20} />
        </button>

        {/* Model Selector Trigger */}
        <button
          onClick={onOpenModelSelector}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition-all max-w-[60%] active:scale-95 shadow-sm"
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
          <Settings size={20} />
        </button>
      </header>

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
