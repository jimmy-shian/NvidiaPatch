import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Shield,
  Key,
  ExternalLink,
  Layers,
  Sparkles,
  Loader2,
  Check
} from 'lucide-react';

export default function MCPManagerTab({
  mcpServers = [],
  onAddServer,
  onToggleServer,
  onDeleteServer,
  onSyncServer,
  onTestConnection
}) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [expandedServerId, setExpandedServerId] = useState(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [authType, setAuthType] = useState('none');
  const [secretToken, setSecretToken] = useState('');
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [isAuthDropdownOpen, setIsAuthDropdownOpen] = useState(false);
  const authDropdownRef = React.useRef(null);

  React.useEffect(() => {
    const handleOutside = (e) => {
      if (authDropdownRef.current && !authDropdownRef.current.contains(e.target)) {
        setIsAuthDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

  const AUTH_OPTIONS = [
    { id: 'none', label: '公開端點 (無認證)', desc: '無需 Token' },
    { id: 'bearer', label: 'Bearer Token', desc: 'Keystore 安全儲存' },
    { id: 'apiKey', label: 'API Key Header', desc: '自訂 Header 金鑰' }
  ];

  const currentAuthOption = AUTH_OPTIONS.find(o => o.id === authType) || AUTH_OPTIONS[0];

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setStatusMessage(null);

    try {
      const res = await onAddServer({
        url: url.trim(),
        name: name.trim(),
        authType,
        secretToken: secretToken.trim(),
        allowPrivateNetwork
      });

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `成功連線並掛載 ${res.tools?.length || 0} 個工具！`
        });
        setUrl('');
        setName('');
        setSecretToken('');
        setIsAdding(false);
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || '連線失敗，請檢查 URL 與端點可達性。'
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || '連線時發生未預期錯誤'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async (id) => {
    setSyncingId(id);
    try {
      const res = await onSyncServer(id);
      if (res.success) {
        if (res.driftDetected) {
          setStatusMessage({
            type: 'warning',
            text: '遠端工具定義已變更，原有工具授權已自動重置，需重新確認。'
          });
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || '同步工具清單失敗'
        });
      }
    } finally {
      setSyncingId(null);
    }
  };

  const toggleExpand = (id) => {
    setExpandedServerId(prev => prev === id ? null : id);
  };

  const fillQuickPreset = (presetUrl, presetName) => {
    setUrl(presetUrl);
    setName(presetName);
    setIsAdding(true);
  };

  return (
    <div className="space-y-5 text-xs text-slate-200">
      {/* Header Info */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex items-start gap-3">
        <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl shrink-0 mt-0.5">
          <Plug size={18} />
        </div>
        <div className="space-y-1">
          <h4 className="font-bold text-white text-sm">Model Context Protocol (MCP)</h4>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            透過標準 MCP 協議動態擴充 LLM 工具能力。支援 Modern 2026-07-28 無狀態 Streamable HTTP 與 Legacy 相容模式，所有 Token 均由本機硬體 Keystore 安全保存。
          </p>
        </div>
      </div>

      {/* Status Feedback Toast */}
      {statusMessage && (
        <div className={`p-3.5 rounded-xl border text-xs flex items-center justify-between animate-fade-in ${
          statusMessage.type === 'success'
            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
            : statusMessage.type === 'warning'
            ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
            : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
        }`}>
          <span>{statusMessage.text}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="ml-2 text-slate-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-300 text-xs">
          已安裝伺服器 ({mcpServers.length})
        </span>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-xs transition-colors shadow-sm"
          >
            <Plus size={14} />
            <span>新增 MCP 伺服器</span>
          </button>
        )}
      </div>

      {/* Add New Server Form */}
      {isAdding && (
        <form onSubmit={handleConnect} className="p-4 bg-slate-900 border border-emerald-500/30 rounded-2xl space-y-3 animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-white text-xs flex items-center gap-1.5">
              <Plug size={14} className="text-emerald-400" />
              連線至新 MCP 端點
            </span>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              取消
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">端點 URL (Streamable HTTP / HTTPS)</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://botsz-tower-check-mcp.hf.space/mcp"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">自訂顯示名稱 (選填)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: Tower Check"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1 relative" ref={authDropdownRef}>
              <label className="text-[11px] font-semibold text-slate-400">認證方式</label>
              <button
                type="button"
                onClick={() => setIsAuthDropdownOpen(prev => !prev)}
                className="w-full flex items-center justify-between bg-slate-950 border border-slate-700 hover:border-slate-600 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors text-left"
              >
                <span className="truncate">{currentAuthOption.label}</span>
                <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${isAuthDropdownOpen ? 'rotate-180 text-emerald-400' : ''}`} />
              </button>

              {isAuthDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-fade-in">
                  {AUTH_OPTIONS.map((opt) => {
                    const isSelected = opt.id === authType;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAuthType(opt.id);
                          setIsAuthDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/15 text-emerald-300 font-semibold'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="truncate">{opt.label}</span>
                          <span className="text-[10px] text-slate-500 truncate">{opt.desc}</span>
                        </div>
                        {isSelected && <Check size={14} className="text-emerald-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {authType !== 'none' && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Key size={12} className="text-amber-400" />
                憑證金鑰 (儲存於 Android Keystore，不寫入普通資料庫)
              </label>
              <input
                type="password"
                value={secretToken}
                onChange={(e) => setSecretToken(e.target.value)}
                placeholder="輸入 Token 或 API Key..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          )}

          <div className="flex items-start gap-2 pt-1">
            <input
              type="checkbox"
              id="allowPrivateNetwork"
              checked={allowPrivateNetwork}
              onChange={(e) => setAllowPrivateNetwork(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0 shrink-0"
            />
            <label htmlFor="allowPrivateNetwork" className="text-[11px] text-slate-400 leading-tight">
              允許連線本機/區域網路測試端點 (開發者選項)
            </label>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-colors shadow-md shadow-emerald-950/40"
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>探測與協商中...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  <span>測試並儲存連線</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Quick Presets Card */}
      {mcpServers.length === 0 && !isAdding && (
        <div className="p-4 bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl space-y-2 text-center py-6">
          <p className="text-slate-400 text-xs">尚未安裝任何 MCP 伺服器。</p>
          <div className="pt-1">
            <button
              onClick={() => fillQuickPreset('https://botsz-tower-check-mcp.hf.space/mcp', 'Tower Check (HF)')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-xl text-xs font-medium border border-emerald-500/20 transition-all"
            >
              <Sparkles size={12} />
              <span>快速填入範例：Tower Check MCP (HuggingFace)</span>
            </button>
          </div>
        </div>
      )}

      {/* Installed Servers List */}
      <div className="space-y-3">
        {mcpServers.map((server) => {
          const isExpanded = expandedServerId === server.id;
          const isSyncing = syncingId === server.id;
          const tools = server.tools || [];

          return (
            <div
              key={server.id}
              className={`bg-slate-900/90 border rounded-2xl overflow-hidden transition-all ${
                server.enabled ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/50 opacity-60'
              }`}
            >
              {/* Server Header Row */}
              <div className="p-3.5 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={`p-2 rounded-xl shrink-0 ${server.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                    <Layers size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-white text-xs truncate max-w-[130px] sm:max-w-[200px]">
                        {server.displayName || 'MCP 伺服器'}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-emerald-400 border border-slate-700 shrink-0">
                        {server.protocolVersion || '2026-07-28'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono truncate max-w-[140px] sm:max-w-[220px]">
                      {server.canonicalEndpoint || server.endpoint}
                    </p>
                  </div>
                </div>

                {/* Right Action Controls */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Enable Switch */}
                  <button
                    onClick={() => onToggleServer(server.id, !server.enabled)}
                    className={`w-8 h-4.5 rounded-full transition-colors relative mr-1 shrink-0 ${
                      server.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${
                        server.enabled ? 'left-[16px]' : 'left-0.5'
                      }`}
                    />
                  </button>

                  {/* Sync Button */}
                  <button
                    onClick={() => handleSync(server.id)}
                    disabled={isSyncing}
                    title="重新同步工具清單"
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <RefreshCw size={13} className={isSyncing ? 'animate-spin text-emerald-400' : ''} />
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={() => onDeleteServer(server.id)}
                    title="刪除伺服器"
                    className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>

                  {/* Expand Tools Accordion */}
                  <button
                    onClick={() => toggleExpand(server.id)}
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              </div>

              {/* Tools Accordion Dropdown */}
              {isExpanded && (
                <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-800/80 bg-slate-950/50 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>掛載工具清單 ({tools.length} 個)</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      ID: {server.id}
                    </span>
                  </div>

                  {tools.length === 0 ? (
                    <p className="text-slate-500 text-[11px] italic py-1">無可用工具</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {tools.map((t) => (
                        <div
                          key={t.providerToolName || t.name}
                          className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1 overflow-hidden"
                        >
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-mono text-emerald-400 font-bold text-xs truncate">
                              {t.name}
                            </span>
                            <span className="text-[9px] text-slate-500 font-mono truncate max-w-[120px] shrink-0 text-right bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                              {t.providerToolName}
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-slate-300 text-[11px] leading-relaxed line-clamp-2">
                              {t.description}
                            </p>
                          )}
                          {t.inputSchema?.properties && (
                            <div className="text-[10px] text-slate-500 font-mono pt-0.5">
                              參數: {Object.keys(t.inputSchema.properties).join(', ') || '無'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
