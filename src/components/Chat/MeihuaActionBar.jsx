import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dices, HelpCircle } from 'lucide-react';

export default function MeihuaActionBar({ 
  onRandomCast, 
  onShowHelp 
}) {
  const { t } = useTranslation();

  return (
    <div className="w-full flex items-center gap-2 p-2.5 px-3 border-t border-slate-800/80 bg-[#0b0f19]/95 backdrop-blur-md">
      <button
        type="button"
        onClick={onRandomCast}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-850 hover:bg-slate-800 active:scale-98 text-slate-200 hover:text-white text-xs font-semibold rounded-xl transition-all border border-slate-700/80 shadow-sm"
      >
        <Dices size={15} className="text-rose-400 shrink-0" />
        <span>{t('meihua.randomCast', '🎲 隨機數字起卦')}</span>
      </button>

      <button
        type="button"
        onClick={onShowHelp}
        className="flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-850 hover:bg-slate-800 active:scale-98 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition-all border border-slate-700/80 shadow-sm"
      >
        <HelpCircle size={15} className="text-amber-400 shrink-0" />
        <span>{t('meihua.help', '❓ 起卦說明')}</span>
      </button>
    </div>
  );
}
