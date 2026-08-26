import React, { useState, useEffect } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';
import { GlobalInteractionCoordinator } from '../../core/mcp/MCPInteractionCoordinator';

export default function MRTRInputModal() {
  const [interaction, setInteraction] = useState(null);
  const [formData, setFormData] = useState({});

  useEffect(() => {
    GlobalInteractionCoordinator.setInteractionHandler(({ interactionId, inputRequests, serverName, toolName }) => {
      return new Promise((resolve) => {
        const initialForm = {};
        for (const req of inputRequests) {
          if (req.name) {
            initialForm[req.name] = req.default ?? '';
          }
        }
        setFormData(initialForm);
        setInteraction({ interactionId, inputRequests, serverName, toolName, resolve });
      });
    });

    return () => {
      GlobalInteractionCoordinator.setInteractionHandler(null);
    };
  }, []);

  if (!interaction) return null;

  const { inputRequests, serverName, toolName, resolve } = interaction;

  const handleSubmit = (e) => {
    e.preventDefault();
    resolve({ responses: formData, cancelled: false });
    setInteraction(null);
  };

  const handleCancel = () => {
    resolve({ cancelled: true });
    setInteraction(null);
  };

  const handleChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-sm bg-[#0e1420] border border-emerald-500/40 rounded-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <HelpCircle size={20} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">MCP 工具需要補充參數</h3>
              <span className="text-[11px] text-slate-400">{serverName} &bull; {toolName}</span>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-1 rounded-xl text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Fields */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {inputRequests.map((req, idx) => {
            const fieldName = req.name || `field_${idx}`;
            const label = req.label || req.name || `參數 ${idx + 1}`;
            const isOptions = Array.isArray(req.options) && req.options.length > 0;

            return (
              <div key={fieldName} className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                  <span>{label}</span>
                  {req.description && (
                    <span className="text-[10px] text-slate-500 font-normal">{req.description}</span>
                  )}
                </label>

                {isOptions ? (
                  <select
                    value={formData[fieldName] || ''}
                    onChange={(e) => handleChange(fieldName, e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    {req.options.map(opt => {
                      const val = typeof opt === 'string' ? opt : opt.value;
                      const text = typeof opt === 'string' ? opt : opt.label;
                      return <option key={val} value={val} className="bg-slate-900 text-white">{text}</option>;
                    })}
                  </select>
                ) : (
                  <input
                    type="text"
                    required={req.required !== false}
                    value={formData[fieldName] || ''}
                    onChange={(e) => handleChange(fieldName, e.target.value)}
                    placeholder={req.placeholder || '請輸入...'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>
            );
          })}

          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Send size={12} />
              <span>送出並繼續</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
