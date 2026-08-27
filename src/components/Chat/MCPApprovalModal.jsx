import React, { useState, useEffect } from 'react';
import { ShieldAlert, Plug, Play, Check, X, AlertTriangle } from 'lucide-react';
import { GlobalApprovalController } from '../../core/mcp/policies/MCPApprovalController';

export default function MCPApprovalModal() {
  const [request, setRequest] = useState(null);

  useEffect(() => {
    // Register approval handler with global controller
    GlobalApprovalController.setApprovalHandler(({ type, payload }) => {
      return new Promise((resolve) => {
        setRequest({ type, payload, resolve });
      });
    });

    return () => {
      GlobalApprovalController.setApprovalHandler(null);
    };
  }, []);

  if (!request) return null;

  const { type, payload, resolve } = request;

  const handleDecision = (allowed, trustScope = 'chat_session') => {
    resolve({ allowed, trustScope });
    setRequest(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-sm bg-[#0e1420] border border-amber-500/40 rounded-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl shrink-0">
            {type === 'connection' ? <Plug size={22} /> : <ShieldAlert size={22} />}
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">
              {type === 'connection' ? 'MCP 伺服器連線授權確認' : 'MCP 工具執行授權確認'}
            </h3>
            <span className="text-[11px] text-amber-400 font-medium">安全審批檢查</span>
          </div>
        </div>

        {/* Content Details */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl space-y-2 text-xs text-slate-300">
          {type === 'connection' ? (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">端點 URL:</span>
                  {payload.isPrivateNetwork && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800/80">
                      區域網路 / 自訂端點 (LAN)
                    </span>
                  )}
                </div>
                <p className="font-mono text-emerald-400 text-xs break-all pt-0.5">{payload.url}</p>
              </div>
              {payload.reason && (
                <div>
                  <span className="text-[11px] text-slate-500">連線目的:</span>
                  <p className="text-slate-300 text-xs">{payload.reason}</p>
                </div>
              )}
              {payload.isPrivateNetwork && (
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800">
                  此端點為同網域或本機私有端點（如 192.168.x.x 或 HTTP 服務），授權後將以系統全域權限信任並允許連線。
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-slate-500">伺服器:</span>
                <span className="text-white font-semibold">{payload.serverName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-slate-500">工具名稱:</span>
                <span className="font-mono text-emerald-400">{payload.toolName}</span>
              </div>
              {payload.description && (
                <p className="text-slate-400 text-[11px] pt-1">{payload.description}</p>
              )}
              {payload.args && Object.keys(payload.args).length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] text-slate-500">呼叫參數:</span>
                  <pre className="mt-1 p-2 bg-slate-950 rounded-xl text-[10px] font-mono text-slate-400 overflow-x-auto">
                    {JSON.stringify(payload.args, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            onClick={() => handleDecision(true, 'always_trusted')}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40"
          >
            <Check size={14} />
            <span>允許 (系統全域永久信任)</span>
          </button>

          <button
            onClick={() => handleDecision(true, 'chat_session')}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition-colors"
          >
            僅此對話中允許
          </button>

          <button
            onClick={() => handleDecision(false)}
            className="w-full py-2 bg-transparent hover:bg-rose-950/30 text-rose-400 font-medium rounded-xl text-xs transition-colors flex items-center justify-center gap-1"
          >
            <X size={14} />
            <span>拒絕</span>
          </button>
        </div>
      </div>
    </div>
  );
}
