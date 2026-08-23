import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash2, Edit3, RotateCw, Bot, User, AlertTriangle, X } from 'lucide-react';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import ThinkingBlock from './ThinkingBlock';

export default function MessageBubble({
  message,
  isLast,
  isStreaming,
  isReasoningActive,
  onRegenerate,
  onDelete,
  onEdit
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [draftText, setDraftText] = useState(message.content);

  const isUser = message.role === 'user';
  const isFailed = !isUser && (message.content?.includes('[錯誤]') || message.content?.includes('[Error]'));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleStartEdit = () => {
    setDraftText(message.content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftText(message.content);
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

  return (
    <div className={`flex flex-col my-2.5 px-2 w-full ${isUser ? 'items-end' : 'items-start'}`}>
      {/* Sender Header */}
      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium text-slate-400">
        {isUser ? (
          <>
            <span>您</span>
            <User size={12} className="text-slate-400" />
          </>
        ) : (
          <>
            <Bot size={13} className="text-emerald-400" />
            <span className="text-emerald-400 font-semibold">{message.modelName || 'Assistant'}</span>
          </>
        )}
      </div>

      {/* Bubble Container */}
      <div
        className={`relative max-w-[92%] sm:max-w-[85%] rounded-2xl p-3.5 shadow-sm text-sm break-words overflow-hidden ${
          isUser
            ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-br-sm'
            : isFailed
              ? 'bg-rose-950/40 border border-rose-800/60 text-slate-100 rounded-bl-sm'
              : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-sm'
        }`}
      >
        {/* Thinking process for Assistant */}
        {!isUser && (
          <ThinkingBlock
            thinkingContent={message.thinkingContent}
            isStreaming={isStreaming && isLast}
            isReasoningActive={isReasoningActive && isLast}
          />
        )}

        {/* Message body / Edit Box */}
        {isEditing ? (
          <div className="flex flex-col gap-2 mt-1 min-w-[240px]">
            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              className="w-full bg-black/50 border border-slate-700 rounded-xl p-2.5 text-xs text-white resize-none outline-none focus:border-emerald-400 font-sans leading-relaxed"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!draftText.trim()}
                className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 font-semibold text-white transition-colors disabled:opacity-40"
              >
                儲存並送出
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap break-words break-all leading-relaxed max-w-full overflow-hidden">{message.content}</div>
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
          <MarkdownRenderer content={message.content} />
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
