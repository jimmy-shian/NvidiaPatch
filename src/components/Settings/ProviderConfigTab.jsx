import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, CheckCircle2, XCircle, RefreshCw, Server, Key, Cpu, ShieldCheck, ChevronDown } from 'lucide-react';
import { PROVIDER_TYPES } from '../../core/providers';

export default function ProviderConfigTab({
  providerConfigs,
  currentProviderId,
  onChangeProvider,
  onUpdateProviderConfig,
  onTestConnection,
  onSyncModels,
  availableModels = []
}) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);

  const activeConfig = providerConfigs[currentProviderId] || {
    id: currentProviderId,
    baseUrl: PROVIDER_TYPES.find(p => p.id === currentProviderId)?.defaultEndpoint || '',
    apiKey: '',
    defaultModel: ''
  };

  const handleProviderChange = (e) => {
    const newId = e.target.value;
    onChangeProvider?.(newId);
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

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h4 className="text-sm font-bold text-white mb-0.5">模型供應商 (Provider) 與金鑰設定</h4>
        <p className="text-slate-400 text-[11px] flex items-center gap-1">
          <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
          <span>BYOK 自備金鑰模式，敏感金鑰使用 AES-GCM 本機加密安全保存。</span>
        </p>
      </div>

      {/* Select Provider Dropdown */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">目前 Provider</label>
        <div className="relative">
          <select
            value={currentProviderId}
            onChange={handleProviderChange}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white appearance-none outline-none focus:border-emerald-500 font-medium text-xs pr-8"
          >
            {PROVIDER_TYPES.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.id === 'nvidia' ? '(預設推薦)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Endpoint URL (Freely editable) */}
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

      {/* API Key */}
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

      {/* Default Model Select Dropdown */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-slate-300 font-semibold">預設模型 (Default Model)</label>
          <button
            type="button"
            onClick={() => setIsCustomModel(prev => !prev)}
            className="text-[11px] text-emerald-400 hover:underline"
          >
            {isCustomModel ? '改為選單選擇' : '自定義模型名稱'}
          </button>
        </div>

        {isCustomModel ? (
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
            <select
              value={activeConfig.defaultModel || (availableModels[0]?.id || '')}
              onChange={e => handleFieldChange('defaultModel', e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white appearance-none outline-none focus:border-emerald-500 text-xs pr-8 font-mono"
            >
              {availableModels.length === 0 ? (
                <option value={activeConfig.defaultModel || ''}>
                  {activeConfig.defaultModel || '請先點擊下方「同步模型列表」'}
                </option>
              ) : (
                availableModels.map(m => (
                  <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                    {m.name || m.id} ({m.id})
                  </option>
                ))
              )}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
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
