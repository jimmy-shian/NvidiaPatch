import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, MessageSquare, Trash2, Edit2, Check, X, Search, Settings, AlertTriangle } from 'lucide-react';

export default function HistoryDrawer({
  isOpen,
  onClose,
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingConvId, setEditingConvId] = useState(null);
  const [editTitleText, setEditTitleText] = useState('');
  const [deletingConvId, setDeletingConvId] = useState(null);

  if (!isOpen) return null;

  const filtered = conversations.filter(c =>
    (c.title || '新對話').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startRename = (conv, e) => {
    e.stopPropagation();
    setEditingConvId(conv.id);
    setEditTitleText(conv.title || '新對話');
  };

  const saveRename = (convId, e) => {
    e?.stopPropagation();
    if (editTitleText.trim()) {
      onRenameConversation?.(convId, editTitleText.trim());
    }
    setEditingConvId(null);
  };

  const cancelRename = (e) => {
    e?.stopPropagation();
    setEditingConvId(null);
  };

  const confirmDelete = (convId, e) => {
    e.stopPropagation();
    setDeletingConvId(convId);
  };

  const executeDelete = (convId, e) => {
    e.stopPropagation();
    onDeleteConversation(convId);
    setDeletingConvId(null);
  };

  const cancelDelete = (e) => {
    e.stopPropagation();
    setDeletingConvId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
      />

      {/* Drawer panel */}
      <div className="relative w-4/5 max-w-xs bg-[#0e1420] border-r border-slate-800/90 h-full flex flex-col z-10 shadow-2xl safe-area-top safe-area-bottom">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm">
              N
            </div>
            <span className="font-bold text-white text-sm font-sans tracking-wide">
              NvidiaPatch Chat
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 transition-transform active:scale-95"
          >
            <Plus size={15} />
            <span>{t('app.newChat')}</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-slate-300">
            <Search size={13} className="text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder={t('app.search')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-transparent outline-none flex-1 text-white placeholder-slate-500 text-xs"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              {t('app.noHistory')}
            </div>
          ) : (
            filtered.map(conv => {
              const isSelected = conv.id === currentConversationId;
              const isEditing = editingConvId === conv.id;
              const isDeleting = deletingConvId === conv.id;

              if (isDeleting) {
                return (
                  <div
                    key={conv.id}
                    className="p-2 rounded-xl bg-rose-950/50 border border-rose-800/80 text-xs flex flex-col gap-1.5 animate-fade-in"
                  >
                    <div className="flex items-center gap-1 text-rose-300 text-[11px] font-semibold">
                      <AlertTriangle size={13} />
                      <span className="truncate">確定刪除此對話？</span>
                    </div>
                    <div className="flex justify-end gap-1.5 pt-0.5">
                      <button
                        onClick={cancelDelete}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                      >
                        取消
                      </button>
                      <button
                        onClick={(e) => executeDelete(conv.id, e)}
                        className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px]"
                      >
                        確定刪除
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-slate-800/90 border-emerald-500/40 text-emerald-300'
                      : 'border-transparent text-slate-300 hover:bg-slate-800/40 hover:text-white'
                  }`}
                  onClick={() => {
                    if (!isEditing) {
                      onSelectConversation(conv.id);
                      onClose();
                    }
                  }}
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 w-full" onClick={e => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editTitleText}
                        onChange={e => setEditTitleText(e.target.value)}
                        className="flex-1 bg-black/60 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-emerald-400"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRename(conv.id, e);
                          if (e.key === 'Escape') cancelRename(e);
                        }}
                      />
                      <button
                        onClick={(e) => saveRename(conv.id, e)}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                        title="儲存"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onClick={cancelRename}
                        className="p-1 text-slate-400 hover:text-slate-200"
                        title="取消"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                        <MessageSquare size={13} className={isSelected ? "text-emerald-400 shrink-0" : "text-slate-500 shrink-0"} />
                        <span className="truncate">{conv.title || '新對話'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => startRename(conv, e)}
                          className="p-1 text-slate-500 hover:text-slate-200 opacity-60 hover:opacity-100 transition-opacity"
                          title="重新命名"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={(e) => confirmDelete(conv.id, e)}
                          className="p-1 text-slate-500 hover:text-rose-400 opacity-60 hover:opacity-100 transition-opacity"
                          title="刪除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer with Settings */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-900/40">
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition-colors"
          >
            <Settings size={14} className="text-slate-400" />
            <span>{t('app.settings')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
