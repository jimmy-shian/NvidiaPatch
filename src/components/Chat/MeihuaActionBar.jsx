import React from 'react';
import { useTranslation } from 'react-i18next';

export default function MeihuaActionBar({ 
  hasMessages, 
  onRandomCast, 
  onTimeCast, 
  onShowHelp 
}) {
  const { t } = useTranslation();

  return (
    <div className="w-full flex flex-col gap-2 p-3 pb-1 border-t border-slate-800 bg-[#0b0f19]">
      {!hasMessages && (
        <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-xl mb-1">
          <h3 className="text-sm font-semibold text-rose-300 mb-1">{t('meihua.welcome', '🌸 梅花易數占卜')}</h3>
          <p className="text-xs text-slate-400">{t('meihua.welcomeDesc', '請描述您欲占問之事，並選擇起卦方式')}</p>
        </div>
      )}
      <div className="flex flex-row gap-2 overflow-x-auto no-scrollbar">
        <button
          onClick={onRandomCast}
          className="whitespace-nowrap flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg transition-colors border border-slate-700"
        >
          <span>{t('meihua.randomCast', '🎲 隨機數字起卦')}</span>
        </button>
        <button
          onClick={onTimeCast}
          className="whitespace-nowrap flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg transition-colors border border-slate-700"
        >
          <span>{t('meihua.timeCast', '⏰ 當前時間起卦')}</span>
        </button>
        <button
          onClick={onShowHelp}
          className="whitespace-nowrap flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg transition-colors border border-slate-700"
        >
          <span>{t('meihua.help', '❓ 起卦說明')}</span>
        </button>
      </div>
    </div>
  );
}
