import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Globe, Shield, Key, RefreshCw, CheckCircle2, XCircle, Info, ExternalLink, Eye, EyeOff } from 'lucide-react';

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
      setTestResult({ success: false, message: '請先輸入 Worker 網址' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection?.(config.url, config.apiKey);
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, message: err.message || '連線測試失敗' });
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
          <h4 className="font-bold text-white text-sm">Cloudflare Worker 搜尋代理</h4>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            將網路搜尋與正文萃取請求轉發至專屬 Cloudflare Worker。避開手機 CGNAT 變動 IP 與 TLS 指紋阻擋，提升即時搜尋成功率；失敗時將自動降級直連。
          </p>
        </div>
      </div>

      {/* Enable Toggle Switch */}
      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
        <div>
          <span className="font-semibold text-white block">啟用 Cloudflare 代理搜尋</span>
          <span className="text-[11px] text-slate-400">
            {config.enabled ? '已啟用：搜尋將優先經由 Worker 代理' : '停用中：使用行動裝置本機直連搜尋'}
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
            <span>Worker 端點網址 (URL)</span>
          </label>
          <input
            type="url"
            value={config.url || ''}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="例如: https://nvidiapatch-search-proxy.xxxx.workers.dev"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 font-mono"
          />
          <p className="text-[10px] text-slate-500">
            請輸入部署好的 Cloudflare Worker 網址（支援 workers.dev 或自訂網域）。
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Key size={13} className="text-amber-400" />
            <span>API 金鑰 (Shared Secret / API Key)</span>
          </label>
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-sky-500">
            <input
              type={showKey ? "text" : "password"}
              value={config.apiKey || ''}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder="輸入由 wrangler secret put API_KEY 設定之密鑰 (選填)"
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
            金鑰存於本機硬體安全模組 (Android Keystore / SecureStorage)，僅發送於 X-Api-Key Header。
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
            <span>{testing ? '連線測試中…' : '測試 Worker 連線 (/health)'}</span>
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
          <span>全自動彈性降級機制 (Graceful Fallback)</span>
        </div>
        <p className="leading-relaxed">
          當未設定代理、Worker 發生連線異常或連續失敗 3 次時，系統將自動靜默切換至現有直連爬取鏈（Bing → DuckDuckGo → Mojeek → Wikipedia），保障對話與資料檢索體驗不中斷。
        </p>
      </div>
    </div>
  );
}
