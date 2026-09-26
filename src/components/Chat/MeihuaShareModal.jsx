import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Share2, Check, Sliders, Image as ImageIcon } from 'lucide-react';
import { shareMeihuaCardAsImage } from '../../core/utils/cardShare';

export default function MeihuaShareModal({
  isOpen,
  onClose,
  calc = {},
  know = {}
}) {
  const [selectedWidth, setSelectedWidth] = useState(640);
  const [customWidth, setCustomWidth] = useState('640');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  if (!isOpen) return null;

  const hexName = calc?.primary?.hexagram?.fullName || '梅花易數';

  const handleWidthChange = (w) => {
    setSelectedWidth(w);
    setCustomWidth(String(w));
  };

  const handleCustomWidthInput = (e) => {
    const val = e.target.value.replace(/\D/g, '');
    setCustomWidth(val);
    const num = parseInt(val, 10);
    if (num >= 320 && num <= 2400) {
      setSelectedWidth(num);
    }
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportSuccess(false);

    try {
      const targetWidth = parseInt(customWidth, 10) || selectedWidth || 640;
      await shareMeihuaCardAsImage({
        calc,
        know,
        width: Math.min(Math.max(targetWidth, 360), 2400),
        title: `${hexName} · 梅花排盤`,
        fileName: `meihua-${Date.now()}.png`
      });
      setExportSuccess(true);
      setTimeout(() => {
        setExportSuccess(false);
        onClose();
      }, 1200);
    } catch (err) {
      console.error('[MeihuaShareModal] Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-[#0e1420] border border-rose-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-rose-950/80 bg-gradient-to-r from-rose-950/50 via-slate-900 to-purple-950/40">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌸</span>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                <span>梅花排盤分享</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono">
                  PNG
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                匯出高解析度梅花排盤卡片
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="關閉"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content & Settings */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs text-slate-300">
          {/* Dimension Controller */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Sliders size={14} className="text-rose-400" />
                <span>畫布寬度 (Width)</span>
              </span>
              <div className="flex items-center gap-1 font-mono text-[11px]">
                <input
                  type="text"
                  value={customWidth}
                  onChange={handleCustomWidthInput}
                  className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-center text-rose-300 font-bold outline-none focus:border-rose-400 shadow-inner"
                />
                <span className="text-slate-500">px</span>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[
                { label: '標準 (640px)', width: 640, desc: '通訊軟體' },
                { label: '寬版 (800px)', width: 800, desc: '社群動態' },
                { label: '超清 (1080px)', width: 1080, desc: '高解析度' }
              ].map(preset => (
                <button
                  key={preset.width}
                  type="button"
                  onClick={() => handleWidthChange(preset.width)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    selectedWidth === preset.width
                      ? 'bg-rose-950/70 border-rose-500 text-rose-200 shadow-sm'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-[11px] truncate">{preset.label}</div>
                  <div className="text-[10px] text-slate-500 truncate">{preset.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-semibold text-xs shadow-md shadow-rose-950/40 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {exportSuccess ? (
              <>
                <Check size={14} className="text-emerald-300" />
                <span>已完成分享 / 匯出！</span>
              </>
            ) : isExporting ? (
              <span>正在生成圖片…</span>
            ) : (
              <>
                <Share2 size={14} />
                <span>匯出並分享圖片</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
