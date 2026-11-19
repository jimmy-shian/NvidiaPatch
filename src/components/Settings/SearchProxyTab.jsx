import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Globe, Shield, Key, RefreshCw, CheckCircle2, XCircle, Info, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { DEFAULT_WORKER_SEARCH_URL } from '../../core/tools/search/WorkerSearchProvider';

export default function SearchProxyTab({
  config = {},
  onUpdateConfig,
  onTestConnection
}) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const isConfigured = Boolean(config.url && config.url.trim());

  const handleToggle = (checked) => {
    onUpdateConfig?.({ enabled: checked });
  };

  const handleUrlChange = (value) => {
    onUpdateConfig?.({ url: value });
  };

  const handleKeyChange = (value) => {
    onUpdateConfig?.({ apiKey: value });
  };

  const handleTest = async () => {
    if (!config.url) {
      setTestResult({ success: false, message: t('settings.searchProxy.enterUrlFirst', '請先輸入 Worker 網址') });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection?.(config.url, config.apiKey);
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, message: err.message || t('settings.searchProxy.testFailed', '連線測試失敗') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      {/* Overview Banner */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex items-start gap-3">
        <div className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl shrink-0 mt-0.5">
          <Cloud size={18} />
        </div>
        <div className="space-y-1">
          <h4 className="font-bold text-white text-sm">{t('settings.searchProxy.title', 'Cloudflare 搜尋代理')}</h4>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            {t('settings.searchProxy.subtitle', '透過 Worker 轉發搜尋與網頁擷取以提高成功率；失敗時自動改用直連。')}
          </p>
        </div>
      </div>

      {/* Enable Toggle Switch */}
      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
        <div>
          <span className="font-semibold text-white block">{t('settings.searchProxy.enableTitle', '啟用代理搜尋')}</span>
          <span className="text-[11px] text-slate-400">
            {config.enabled ? t('settings.searchProxy.enabledDesc', '優先經由 Worker 搜尋') : t('settings.searchProxy.disabledDesc', '使用本機直連搜尋')}
          </span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(config.enabled)}
            onChange={(e) => handleToggle(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
        </label>
      </div>

      {/* Form Fields */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3.5">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Globe size={13} className="text-sky-400" />
            <span>{t('settings.searchProxy.urlLabel', 'Worker 網址')}</span>
          </label>
          <input
            type="url"
            value={config.url || ''}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder={t('settings.searchProxy.urlPlaceholder', `例如: ${DEFAULT_WORKER_SEARCH_URL}`, { url: DEFAULT_WORKER_SEARCH_URL })}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 font-mono"
          />
          <p className="text-[10px] text-slate-500">
            {t('settings.searchProxy.urlHint', '支援 workers.dev 或自訂網域。')}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Key size={13} className="text-amber-400" />
            <span>{t('settings.searchProxy.apiKeyLabel', 'API Key（選填）')}</span>
          </label>
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-sky-500">
            <input
              type={showKey ? "text" : "password"}
              value={config.apiKey || ''}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={t('settings.searchProxy.apiKeyPlaceholder', '輸入 Worker API_KEY 密鑰')}
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
          <p className="text-[10px] text-slate-500">
            {t('settings.searchProxy.apiKeyHint', '本機加密儲存，僅透過 X-Api-Key 傳送。')}
          </p>
        </div>

        {/* Test Connection Button */}
        <div className="pt-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !config.url}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700 active:scale-95 text-xs"
          >
            <RefreshCw size={13} className={testing ? "animate-spin shrink-0 text-sky-400" : "shrink-0"} />
            <span>{testing ? t('settings.providers.testing', '測試中…') : t('settings.searchProxy.testBtn', '測試連線 (/health)')}</span>
          </button>
        </div>

        {/* Test Result Message */}
        {testResult && (
          <div className={`p-3 rounded-xl border flex items-start gap-2 text-xs animate-fade-in ${
            testResult.success
              ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
          }`}>
            {testResult.success ? (
              <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-400" />
            ) : (
              <XCircle size={15} className="shrink-0 mt-0.5 text-rose-400" />
            )}
            <span className="break-all">{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Fallback info */}
      <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-2xl space-y-1.5 text-[11px] text-slate-400">
        <div className="font-semibold text-slate-300 flex items-center gap-1">
          <Shield size={12} className="text-emerald-400" />
          <span>{t('settings.searchProxy.fallbackTitle', '自動降級機制')}</span>
        </div>
        <p className="leading-relaxed">
          {t('settings.searchProxy.fallbackDesc', '代理未設定或連線異常時，自動切換本機搜尋。')}
        </p>
      </div>
    </div>
  );
}
