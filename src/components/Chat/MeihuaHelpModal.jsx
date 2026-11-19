import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Sparkles, Clock, Dices, Hash, Layers, GitCompare, CheckCircle2 } from 'lucide-react';

export default function MeihuaHelpModal({ isOpen, onClose }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-lg max-h-[85vh] bg-[#0e1420] border border-rose-500/40 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-up">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 px-5 border-b border-slate-800 bg-slate-900/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">
                {t('meihua.helpModal.title', '🌸 梅花易數·起卦指南與解讀規則')}
              </h3>
              <p className="text-[11px] text-rose-300/80">
                {t('meihua.helpModal.subtitle', '確定性周易排盤與體用生剋決策架構')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed text-slate-300">
          {/* Section 1: 起卦方式 */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <Layers size={14} />
              <span>{t('meihua.helpModal.methodsTitle', '一、起卦方式')}</span>
            </h4>
            <div className="space-y-2">
              <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-2xl">
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  <Clock size={13} className="text-amber-400 shrink-0" />
                  <span>{t('meihua.helpModal.timeCastingTitle', '1. 時間起卦（預設）')}</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  {t('meihua.helpModal.timeCastingDesc', '依提問當下農曆年月日時自動排盤，無需手動輸入時間。')}
                </p>
              </div>

              <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-2xl">
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  <Dices size={13} className="text-rose-400 shrink-0" />
                  <span>{t('meihua.helpModal.randomCastingTitle', '2. 隨機數字起卦')}</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  {t('meihua.helpModal.randomCastingDesc', '點擊「🎲 隨機數字起卦」產生三組數字，對應上卦、下卦與動爻。')}
                </p>
              </div>

              <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-2xl">
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  <Hash size={13} className="text-emerald-400 shrink-0" />
                  <span>{t('meihua.helpModal.customNumbersTitle', '3. 自訂數字起卦')}</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  {t('meihua.helpModal.customNumbersDesc', '於問題中輸入 2 或 3 組數字（如「6, 8」），系統自動解析排盤。')}
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: 卦象結構與排盤維度 */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <GitCompare size={14} />
              <span>{t('meihua.helpModal.structureTitle', '二、卦象結構')}</span>
            </h4>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-emerald-300 mb-0.5">{t('meihua.helpModal.primaryTitle', '本卦')}</div>
                <div className="text-slate-400">{t('meihua.helpModal.primaryDesc', '當前現狀與基本盤。')}</div>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-amber-300 mb-0.5">{t('meihua.helpModal.movingTitle', '動爻')}</div>
                <div className="text-slate-400">{t('meihua.helpModal.movingDesc', '變化觸發點與關鍵轉折。')}</div>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-purple-300 mb-0.5">{t('meihua.helpModal.mutualTitle', '互卦')}</div>
                <div className="text-slate-400">{t('meihua.helpModal.mutualDesc', '中間過程與內部變化。')}</div>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-sky-300 mb-0.5">{t('meihua.helpModal.changedTitle', '變卦')}</div>
                <div className="text-slate-400">{t('meihua.helpModal.changedDesc', '最終趨勢與結果走向。')}</div>
              </div>
            </div>
          </div>

          {/* Section 3: 體用生剋與吉凶準則 */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <Sparkles size={14} />
              <span>{t('meihua.helpModal.tiYongTitle', '三、體用生剋')}</span>
            </h4>
            <p className="text-[11px] text-slate-400">
              {t('meihua.helpModal.tiYongConcept', '體卦代表自己或主體（不動卦）；用卦代表外在環境與事物（動爻所在卦）。')}
            </p>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300">
                <span className="font-bold shrink-0">{t('meihua.helpModal.yongGeneratesTi', '用生體（大吉）')}</span>
                <span className="text-emerald-400 text-right">{t('meihua.helpModal.yongGeneratesTiDesc', '得外力相助，事半功倍')}</span>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-emerald-200">
                <span className="font-bold shrink-0">{t('meihua.helpModal.biHe', '體用比和（吉）')}</span>
                <span className="text-emerald-300 text-right">{t('meihua.helpModal.biHeDesc', '內外契合，順遂可成')}</span>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300">
                <span className="font-bold shrink-0">{t('meihua.helpModal.tiGeneratesYong', '體生用（耗泄）')}</span>
                <span className="text-amber-400 text-right">{t('meihua.helpModal.tiGeneratesYongDesc', '付出較多，多勞少得')}</span>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-950/20 border border-amber-800/30 text-amber-200">
                <span className="font-bold shrink-0">{t('meihua.helpModal.tiControlsYong', '體剋用（小吉）')}</span>
                <span className="text-amber-300 text-right">{t('meihua.helpModal.tiControlsYongDesc', '需主動克服，努力可成')}</span>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300">
                <span className="font-bold shrink-0">{t('meihua.helpModal.yongControlsTi', '用剋體（凶）')}</span>
                <span className="text-rose-400 text-right">{t('meihua.helpModal.yongControlsTiDesc', '外在阻力大，宜保守謹慎')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-5 border-t border-slate-800 bg-slate-900/50 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl transition-colors shadow-lg shadow-rose-950/40"
          >
            <CheckCircle2 size={14} />
            <span>{t('meihua.helpModal.understood', '我知道了')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
