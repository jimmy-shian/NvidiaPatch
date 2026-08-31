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
              <span>{t('meihua.helpModal.methodsTitle', '一、起卦方式支援')}</span>
            </h4>
            <div className="space-y-2">
              <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-2xl">
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  <Clock size={13} className="text-amber-400 shrink-0" />
                  <span>{t('meihua.helpModal.timeCastingTitle', '1. 當前時間起卦 (內建預設)')}</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  {t('meihua.helpModal.timeCastingDesc', '系統自動以提問當下的公曆與農曆時辰干支（年月日時數值）進行確定性排盤，內建時空背景與精確時間刻度，毋須手動輸入時間，最適合即時事態占問。')}
                </p>
              </div>

              <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-2xl">
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  <Dices size={13} className="text-rose-400 shrink-0" />
                  <span>{t('meihua.helpModal.randomCastingTitle', '2. 隨機靈動數起卦')}</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  {t('meihua.helpModal.randomCastingDesc', '點擊「🎲 隨機數字起卦」將生成三組 1~999 靈動數（分別代表上卦、下卦與動爻），捕捉當下心念靈機契機，數值獨立包裹不影響後續對話。')}
                </p>
              </div>

              <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-2xl">
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  <Hash size={13} className="text-emerald-400 shrink-0" />
                  <span>{t('meihua.helpModal.customNumbersTitle', '3. 自訂數字起卦')}</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  {t('meihua.helpModal.customNumbersDesc', '亦可於問題中直接附帶 2 組數字（如「6, 8」以兩數之和求動爻）或 3 組數字（第三數為動爻），系統自動解析為先天八卦排盤。')}
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: 卦象結構與排盤維度 */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <GitCompare size={14} />
              <span>{t('meihua.helpModal.structureTitle', '二、卦象結構與排盤層次')}</span>
            </h4>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-emerald-300 mb-0.5">本卦（主卦）</div>
                <div className="text-slate-400">代表事態當前現狀與基本盤結構。</div>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-amber-300 mb-0.5">動爻</div>
                <div className="text-slate-400">事態變化的關鍵觸發點與轉折樞紐。</div>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-purple-300 mb-0.5">互卦</div>
                <div className="text-slate-400">事態推進的中間過程、隱藏因素與內部運作。</div>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl">
                <div className="font-semibold text-sky-300 mb-0.5">變卦</div>
                <div className="text-slate-400">事態最終發展趨勢與後續結果走向。</div>
              </div>
            </div>
          </div>

          {/* Section 3: 體用生剋與吉凶準則 */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <Sparkles size={14} />
              <span>{t('meihua.helpModal.tiYongTitle', '三、體用生剋與吉凶判讀')}</span>
            </h4>
            <p className="text-[11px] text-slate-400">
              {t('meihua.helpModal.tiYongConcept', '體卦（不動卦）代表占者主體或事物本質；用卦（動爻所在卦）代表外在環境與事態變數。')}
            </p>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300">
                <span className="font-bold">用生體（大吉）</span>
                <span className="text-emerald-400">外部助力豐沛，事半功倍，得貴人相助</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-emerald-200">
                <span className="font-bold">體用比和（吉）</span>
                <span className="text-emerald-300">同氣相求，事態和順，同心協力</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300">
                <span className="font-bold">體生用（耗泄）</span>
                <span className="text-amber-400">多勞少得，需付出心力成本，雖有成但耗神</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/20 border border-amber-800/30 text-amber-200">
                <span className="font-bold">體剋用（小吉）</span>
                <span className="text-amber-300">事需力爭，經由自身努力可克服困難獲勝</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300">
                <span className="font-bold">用剋體（凶咎）</span>
                <span className="text-rose-400">外在壓力阻礙大，受挫或不利，宜退守謹慎</span>
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
