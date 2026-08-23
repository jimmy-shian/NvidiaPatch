import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, CheckCircle2, XCircle, RefreshCw, Server, Key, Cpu, ShieldCheck, ChevronDown, ChevronUp, Check, AlertCircle, Search } from 'lucide-react';
import { PROVIDER_TYPES } from '../../core/providers';

export function getProviderDisplayLabel(provider) {
  if (!provider) return '';
  return provider.displayName || provider.name || provider.id;
}

export function getModelDisplayLabel(model) {
  if (!model) return '';
  if (typeof model === 'string') return model;
  return model.name || model.displayName || model.id;
}

export default function ProviderConfigTab({
  providerConfigs,
  currentProviderId,
  onChangeProvider,
  onUpdateProviderConfig,
  onTestConnection,
  onSyncModels,
  availableModels = [],
  isLoadingModels = false,
  modelsError = null
}) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [modelMode, setModelMode] = useState('select'); // 'select' | 'custom'
  
  // Custom dropdown open states
  const [isProviderOpen, setIsProviderOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');

  const activeConfig = providerConfigs[currentProviderId] || {
    id: currentProviderId,
    baseUrl: PROVIDER_TYPES.find(p => p.id === currentProviderId)?.defaultEndpoint || '',
    apiKey: '',
    defaultModel: ''
  };

  const selectedProviderObj = PROVIDER_TYPES.find(p => p.id === currentProviderId) || PROVIDER_TYPES[0];
  const selectedProviderLabel = getProviderDisplayLabel(selectedProviderObj);

  const selectedModelId = activeConfig.defaultModel || (availableModels[0]?.id || '');
  const selectedModelObj = availableModels.find(m => m.id === selectedModelId);
  const selectedModelLabel = selectedModelObj ? getModelDisplayLabel(selectedModelObj) : selectedModelId;

  const handleProviderSelect = (providerId) => {
    setIsProviderOpen(false);
    onChangeProvider?.(providerId);
  };

  const handleModelSelect = (modelId) => {
    setIsModelDropdownOpen(false);
    handleFieldChange('defaultModel', modelId);
  };

  const handleFieldChange = (field, value) => {
    onUpdateProviderConfig(currentProviderId, {
      ...activeConfig,
      [field]: value
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection(currentProviderId);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSyncModels(currentProviderId);
    } finally {
      setSyncing(false);
    }
  };

  const filteredModels = availableModels.filter(m => {
    const q = modelSearchQuery.toLowerCase();
    return (m.id && m.id.toLowerCase().includes(q)) ||
           (m.name && m.name.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h4 className="text-sm font-bold text-white mb-0.5">模型供應商 (Provider) 與金鑰設定</h4>
        <p className="text-slate-400 text-[11px] flex items-center gap-1">
          <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
          <span>BYOK 自備金鑰模式，敏感金鑰使用 AES-GCM 本機加密安全保存。</span>
        </p>
      </div>

      {/* 1. Custom Provider Dropdown (100% Reliable Custom React Menu) */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">目前 Provider</label>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setIsProviderOpen(prev => !prev);
              setIsModelDropdownOpen(false);
            }}
            className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl px-3.5 py-2.5 text-left transition-colors focus:border-emerald-500 shadow-sm"
          >
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <Server size={14} className="text-emerald-400 shrink-0" />
              <span className="font-semibold text-white text-xs truncate">
                {selectedProviderLabel}
              </span>
              {currentProviderId === 'nvidia' && (
                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-medium shrink-0">
                  預設推薦
                </span>
              )}
            </div>
            {isProviderOpen ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
          </button>

          {isProviderOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#111827] border border-slate-700 rounded-xl shadow-2xl z-30 p-1.5 space-y-1 animate-fade-in max-h-60 overflow-y-auto">
              {PROVIDER_TYPES.map(p => {
                const isSelected = p.id === currentProviderId;
                const label = getProviderDisplayLabel(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderSelect(p.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-200 font-bold border border-emerald-500/40'
                        : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white font-medium truncate">{label}</span>
                      {p.id === 'nvidia' && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1 rounded">
                          推薦
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={14} className="text-emerald-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 2. Endpoint URL (Freely editable) */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">API Endpoint 端點網址</label>
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-emerald-500">
          <Server size={14} className="text-slate-500 shrink-0" />
          <input
            type="text"
            value={activeConfig.baseUrl || ''}
            onChange={e => handleFieldChange('baseUrl', e.target.value)}
            placeholder="例如：https://integrate.api.nvidia.com/v1"
            className="w-full bg-transparent text-white outline-none font-mono text-[11px]"
          />
        </div>
      </div>

      {/* 3. API Key */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">API 金鑰 (API Key)</label>
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-emerald-500">
          <Key size={14} className="text-slate-500 shrink-0" />
          <input
            type={showKey ? "text" : "password"}
            value={activeConfig.apiKey || ''}
            onChange={e => handleFieldChange('apiKey', e.target.value)}
            placeholder={currentProviderId === 'nvidia' ? '輸入 nvapi-...' : '輸入 API 金鑰 (sk-...)'}
            className="w-full bg-transparent text-white outline-none font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="text-slate-500 hover:text-slate-300 p-0.5"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* 4. Default Model Selection Mode (選單 / 自訂) */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <label className="block text-slate-300 font-semibold">預設模型</label>
          <div className="flex items-center gap-3 text-xs bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
            <label className="flex items-center gap-1 cursor-pointer text-slate-300">
              <input
                type="radio"
                name="modelMode"
                value="select"
                checked={modelMode === 'select'}
                onChange={() => setModelMode('select')}
                className="accent-emerald-500"
              />
              <span>選單</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer text-slate-300">
              <input
                type="radio"
                name="modelMode"
                value="custom"
                checked={modelMode === 'custom'}
                onChange={() => setModelMode('custom')}
                className="accent-emerald-500"
              />
              <span>自訂</span>
            </label>
          </div>
        </div>

        {modelMode === 'custom' ? (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-emerald-500">
            <Cpu size={14} className="text-slate-500 shrink-0" />
            <input
              type="text"
              value={activeConfig.defaultModel || ''}
              onChange={e => handleFieldChange('defaultModel', e.target.value)}
              placeholder="例如：nvidia/llama-3.1-nemotron-120b-instruct"
              className="w-full bg-transparent text-white outline-none font-mono text-[11px]"
            />
          </div>
        ) : (
          <div className="relative">
            {isLoadingModels ? (
              <div className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-400 text-xs flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin text-emerald-400" />
                <span>載入中…</span>
              </div>
            ) : modelsError ? (
              <div className="w-full bg-rose-950/40 border border-rose-800 rounded-xl px-3.5 py-2.5 text-xs text-rose-300 flex items-center justify-between">
                <span>模型資料載入失敗</span>
                <button type="button" onClick={handleSync} className="text-emerald-400 underline text-[11px]">重試</button>
              </div>
            ) : availableModels.length === 0 ? (
              <div className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-400 flex items-center justify-between">
                <span>沒有可用模型</span>
                <button type="button" onClick={handleSync} className="text-emerald-400 underline text-[11px]">同步模型</button>
              </div>
            ) : (
              <>
                {/* Collapsed Model Trigger Button */}
                <button
                  type="button"
                  onClick={() => {
                    setIsModelDropdownOpen(prev => !prev);
                    setIsProviderOpen(false);
                  }}
                  className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl px-3.5 py-2.5 text-left transition-colors focus:border-emerald-500 shadow-sm"
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-semibold text-white text-xs truncate">
                      {selectedModelLabel || '請選擇預設模型'}
                    </span>
                    {selectedModelId && (
                      <span className="text-[10px] text-slate-400 font-mono truncate">
                        {selectedModelId}
                      </span>
                    )}
                  </div>
                  {isModelDropdownOpen ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
                </button>

                {/* Expanded Custom Model Picker Popover */}
                {isModelDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#111827] border border-slate-700 rounded-xl shadow-2xl z-30 p-2 space-y-1.5 animate-fade-in max-h-72 flex flex-col">
                    {/* Search inside model dropdown */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/50 border border-slate-700 rounded-lg text-xs">
                      <Search size={12} className="text-slate-400 shrink-0" />
                      <input
                        type="text"
                        placeholder="搜尋模型名稱或 ID..."
                        value={modelSearchQuery}
                        onChange={e => setModelSearchQuery(e.target.value)}
                        className="bg-transparent text-white outline-none w-full text-xs placeholder-slate-500"
                        autoFocus
                      />
                    </div>

                    {/* Model Items List */}
                    <div className="flex-1 overflow-y-auto space-y-1 max-h-48 pr-1">
                      {filteredModels.length === 0 ? (
                        <div className="py-4 text-center text-slate-500 text-xs">
                          無相符模型
                        </div>
                      ) : (
                        filteredModels.map(m => {
                          const isSelected = m.id === selectedModelId;
                          const label = getModelDisplayLabel(m);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => handleModelSelect(m.id)}
                              className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all border ${
                                isSelected
                                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                                  : 'bg-slate-900/50 border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
                              }`}
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <span className="font-semibold text-white text-xs truncate">{label}</span>
                                <span className="text-[10px] text-slate-400 font-mono truncate">{m.id}</span>
                              </div>
                              {isSelected && <Check size={14} className="text-emerald-400 shrink-0" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Test Connection & Sync Buttons */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700 active:scale-95"
        >
          <RefreshCw size={13} className={testing ? "animate-spin" : ""} />
          <span>{testing ? '測試連線中...' : '測試連線'}</span>
        </button>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-emerald-950/40 active:scale-95"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          <span>{syncing ? '同步模型中...' : '同步模型列表'}</span>
        </button>
      </div>

      {/* Test result message */}
      {testResult && (
        <div className={`p-3 rounded-xl border flex items-start gap-2 text-xs ${
          testResult.success
            ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
            : 'bg-rose-950/30 border-rose-500/50 text-rose-300'
        }`}>
          {testResult.success ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : <XCircle size={15} className="shrink-0 mt-0.5" />}
          <span className="break-all">{testResult.message}</span>
        </div>
      )}
    </div>
  );
}
