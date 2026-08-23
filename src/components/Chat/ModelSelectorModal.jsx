import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, RefreshCw, Check, Cpu, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function ModelSelectorModal({
  isOpen,
  onClose,
  currentProviderId,
  currentModelId,
  availableModels = [],
  onSelectModel,
  onSyncModels,
  isSyncing
}) {
  const { t } = useTranslation();
  const [customInput, setCustomInput] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [syncStatus, setSyncStatus] = useState(null); // { type: 'success' | 'error', message: string }

  if (!isOpen) return null;

  const filteredModels = availableModels.filter(m =>
    m.id.toLowerCase().includes(filterQuery.toLowerCase()) ||
    (m.name && m.name.toLowerCase().includes(filterQuery.toLowerCase()))
  );

  const handleCustomSubmit = (e) => {
    e.preventDefault();
    if (customInput.trim()) {
      onSelectModel(currentProviderId, customInput.trim());
      onClose();
    }
  };

  const handleSyncClick = async () => {
    setSyncStatus(null);
    try {
      const res = await onSyncModels();
      if (res && res.success) {
        setSyncStatus({ type: 'success', message: `同步成功！已獲取 ${res.count || availableModels.length} 個模型` });
      } else if (res && !res.success) {
        setSyncStatus({ type: 'error', message: res.message || '同步失敗' });
      }
    } catch (err) {
      setSyncStatus({ type: 'error', message: err.message || '連線錯誤' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full sm:max-w-md bg-[#111827] border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cpu className="text-emerald-400" size={18} />
            <h3 className="font-bold text-white text-base">{t('chat.selectModel')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Sync Status Banner */}
        {syncStatus && (
          <div className={`px-4 py-2.5 text-xs flex items-center gap-2 ${
            syncStatus.type === 'success'
              ? 'bg-emerald-950/60 border-b border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/60 border-b border-rose-500/30 text-rose-300'
          }`}>
            {syncStatus.type === 'success' ? <CheckCircle2 size={15} className="shrink-0 text-emerald-400" /> : <AlertCircle size={15} className="shrink-0 text-rose-400" />}
            <span className="flex-1">{syncStatus.message}</span>
          </div>
        )}

        {/* Search & Sync Actions */}
        <div className="p-4 border-b border-slate-800/80 flex flex-col gap-2.5 bg-slate-900/40">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="搜尋模型名稱或 ID..."
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              className="flex-1 bg-black/40 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleSyncClick}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-400 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={13} className={isSyncing ? "animate-spin text-emerald-400" : ""} />
              <span>{isSyncing ? t('settings.providers.syncing') : t('settings.providers.syncModels')}</span>
            </button>
          </div>

          {/* Custom Model ID Entry */}
          <form onSubmit={handleCustomSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="或手動輸入 Model ID (如 nvidia/...)"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              className="flex-1 bg-black/40 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!customInput.trim()}
              className="px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-40"
            >
              套用
            </button>
          </form>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 max-h-[50vh]">
          {filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500 text-xs gap-2">
              <AlertCircle size={24} className="text-slate-600" />
              <span>查無模型。可點擊右上角「同步模型」或於上方手動輸入 ID。</span>
            </div>
          ) : (
            filteredModels.map(m => {
              const isSelected = m.id === currentModelId;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onSelectModel(currentProviderId, m.id);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition-all border ${
                    isSelected
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-sm'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-semibold text-slate-100 truncate">{m.name || m.id}</span>
                    <span className="text-[11px] text-slate-400 font-mono truncate">{m.id}</span>
                  </div>
                  {isSelected && <Check size={16} className="text-emerald-400 shrink-0 ml-2" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
