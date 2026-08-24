import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, RefreshCw, Check, Cpu, AlertCircle, CheckCircle2, Star, Layers } from 'lucide-react';

export function groupModelsByFamily(models = []) {
  const groups = {
    nemotron: { key: 'nemotron', title: 'NVIDIA Nemotron 系列', icon: '⚡', models: [] },
    deepseek: { key: 'deepseek', title: 'DeepSeek 系列', icon: '🧠', models: [] },
    minimax: { key: 'minimax', title: 'MiniMax 系列', icon: '🔮', models: [] },
    openai: { key: 'openai', title: 'OpenAI / GPT 系列', icon: '🤖', models: [] },
    claude: { key: 'claude', title: 'Claude 系列', icon: '🎭', models: [] },
    gemini: { key: 'gemini', title: 'Google Gemini / Gemma 系列', icon: '✨', models: [] },
    llama: { key: 'llama', title: 'Meta Llama 系列', icon: '🦙', models: [] },
    qwen: { key: 'qwen', title: 'Qwen 通義千問系列', icon: '🌐', models: [] },
    mistral: { key: 'mistral', title: 'Mistral 系列', icon: '🌪️', models: [] },
    other: { key: 'other', title: '其他模型 (Other Models)', icon: '📦', models: [] }
  };

  for (const m of models) {
    const id = (m.id || '').toLowerCase();
    const name = (m.name || '').toLowerCase();

    if (id.includes('nemotron') || id.includes('cosmos') || name.includes('nemotron')) {
      groups.nemotron.models.push(m);
    } else if (id.includes('deepseek') || name.includes('deepseek')) {
      groups.deepseek.models.push(m);
    } else if (id.includes('minimax') || name.includes('minimax')) {
      groups.minimax.models.push(m);
    } else if (id.includes('gpt') || id.includes('openai') || id.includes('o1') || id.includes('o3') || name.includes('gpt')) {
      groups.openai.models.push(m);
    } else if (id.includes('claude') || name.includes('claude')) {
      groups.claude.models.push(m);
    } else if (id.includes('gemini') || id.includes('gemma') || name.includes('gemini') || name.includes('gemma')) {
      groups.gemini.models.push(m);
    } else if (id.includes('llama') || id.includes('meta/') || name.includes('llama')) {
      groups.llama.models.push(m);
    } else if (id.includes('qwen') || name.includes('qwen')) {
      groups.qwen.models.push(m);
    } else if (id.includes('mistral') || id.includes('mixtral') || id.includes('codestral') || name.includes('mistral')) {
      groups.mistral.models.push(m);
    } else {
      groups.other.models.push(m);
    }
  }

  return Object.values(groups).filter(g => g.models.length > 0);
}

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
  const [syncStatus, setSyncStatus] = useState(null);

  const activeModelObj = useMemo(() => {
    return availableModels.find(m => m.id === currentModelId) || { id: currentModelId, name: currentModelId };
  }, [availableModels, currentModelId]);

  const filteredModels = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return availableModels;
    return availableModels.filter(m =>
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.name && m.name.toLowerCase().includes(q))
    );
  }, [availableModels, filterQuery]);

  const modelGroups = useMemo(() => {
    return groupModelsByFamily(filteredModels);
  }, [filteredModels]);

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in safe-area-top safe-area-bottom">
      <div className="w-full sm:max-w-lg bg-[#111827] border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#0e1420]">
          <div className="flex items-center gap-2">
            <Cpu className="text-emerald-400" size={18} />
            <h3 className="font-bold text-white text-sm sm:text-base">{t('chat.selectModel')}</h3>
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
          <div className={`px-4 py-2 text-xs flex items-center gap-2 ${
            syncStatus.type === 'success'
              ? 'bg-emerald-950/60 border-b border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/60 border-b border-rose-500/30 text-rose-300'
          }`}>
            {syncStatus.type === 'success' ? <CheckCircle2 size={14} className="shrink-0 text-emerald-400" /> : <AlertCircle size={14} className="shrink-0 text-rose-400" />}
            <span className="flex-1 text-[11px]">{syncStatus.message}</span>
          </div>
        )}

        {/* Search & Sync Actions Responsive Toolbar */}
        <div className="p-3.5 border-b border-slate-800/80 flex flex-col gap-2.5 bg-slate-900/40">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="搜尋模型名稱或 ID..."
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              className="flex-1 min-w-0 bg-black/40 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={handleSyncClick}
              disabled={isSyncing}
              className="shrink-0 h-9 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 border border-slate-700"
            >
              <RefreshCw size={13} className={isSyncing ? "animate-spin text-emerald-400 shrink-0" : "shrink-0"} />
              <span className="whitespace-nowrap">{isSyncing ? '同步中…' : '同步模型'}</span>
            </button>
          </div>

          {/* Custom Model ID Entry */}
          <form onSubmit={handleCustomSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="或手動輸入 Model ID (如 nvidia/...)"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              className="flex-1 min-w-0 bg-black/40 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!customInput.trim()}
              className="shrink-0 px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-40"
            >
              套用
            </button>
          </form>
        </div>

        {/* Model Groups & Pinned Current Model List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 max-h-[55vh] scrollbar-thin">
          {/* 1. PINNED CURRENT ACTIVE MODEL (Always at top) */}
          {currentModelId && (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 uppercase tracking-wider px-1 mb-1.5">
                <Star size={12} className="fill-emerald-400" />
                <span>目前使用中模型 (Current Active Model)</span>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/50 text-emerald-300 shadow-sm flex items-center justify-between">
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="font-bold text-white text-xs truncate">
                    {activeModelObj.name || activeModelObj.id}
                  </span>
                  <span className="text-[10px] text-emerald-400/80 font-mono truncate">{currentModelId}</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold shrink-0">
                  <Check size={12} />
                  <span>使用中</span>
                </div>
              </div>
            </div>
          )}

          {/* 2. GROUPED MODEL CATALOG */}
          {modelGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500 text-xs gap-2">
              <AlertCircle size={24} className="text-slate-600" />
              <span>查無相符模型。可點擊上方「同步模型」或手動輸入 ID。</span>
            </div>
          ) : (
            modelGroups.map(group => (
              <div key={group.key} className="space-y-1.5">
                {/* Family Header */}
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 px-1 pt-1">
                  <span>{group.icon}</span>
                  <span>{group.title}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-800/80 px-1.5 py-0.2 rounded-full font-normal">
                    {group.models.length}
                  </span>
                </div>

                {/* Models in Family */}
                <div className="grid grid-cols-1 gap-1.5">
                  {group.models.map(m => {
                    const isSelected = m.id === currentModelId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectModel(currentProviderId, m.id);
                          onClose();
                        }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-all border ${
                          isSelected
                            ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-sm'
                            : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/60 hover:text-white'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold text-slate-100 truncate">{m.name || m.id}</span>
                          <span className="text-[10px] text-slate-400 font-mono truncate">{m.id}</span>
                        </div>
                        {isSelected && <Check size={15} className="text-emerald-400 shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
