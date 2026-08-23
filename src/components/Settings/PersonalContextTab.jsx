import React from 'react';
import { useTranslation } from 'react-i18next';
import { User, Globe, MessageSquare, Sparkles, FileText, ChevronDown } from 'lucide-react';
import { SUPPORTED_LANGUAGES, SUPPORTED_STYLES } from '../../core/context/contextManager';

export default function PersonalContextTab({ contextSettings, onUpdateContext }) {
  const { t } = useTranslation();

  const handleChange = (field, value) => {
    onUpdateContext({
      ...contextSettings,
      [field]: value
    });
  };

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h4 className="text-sm font-bold text-white mb-0.5">個人偏好與背景設定</h4>
        <p className="text-slate-400 text-[11px]">設定您的稱謂、回答語言、回答風格與長期背景資料，模型將自動以此 Context 進行客製化回應。</p>
      </div>

      {/* User Name */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">使用者稱謂 / 暱稱</label>
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-emerald-500">
          <User size={14} className="text-slate-500 shrink-0" />
          <input
            type="text"
            value={contextSettings.userName || ''}
            onChange={e => handleChange('userName', e.target.value)}
            placeholder="例如：Jimmy / 提督 / 博士"
            className="w-full bg-transparent text-white outline-none text-xs"
          />
        </div>
      </div>

      {/* Response Language */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">回答語言偏好 (10 種語言 + 注音文)</label>
        <div className="relative">
          <select
            value={contextSettings.responseLanguage || 'zh-TW'}
            onChange={e => handleChange('responseLanguage', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white appearance-none outline-none focus:border-emerald-500 text-xs pr-8"
          >
            {SUPPORTED_LANGUAGES.map(lang => (
              <option key={lang.id} value={lang.id} className="bg-slate-900 text-white">
                {lang.name} ({lang.id})
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Response Style */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">回答風格</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SUPPORTED_STYLES.map(style => (
            <button
              key={style.id}
              type="button"
              onClick={() => handleChange('responseStyle', style.id)}
              className={`py-2 px-2.5 rounded-xl border text-xs font-medium transition-all text-left flex flex-col gap-0.5 ${
                contextSettings.responseStyle === style.id
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span className="font-semibold text-white">{style.name}</span>
              <span className="text-[10px] opacity-75 line-clamp-1">{style.id === 'adhd' ? '結論先行・條列精煉' : style.prompt.slice(0, 14) + '...'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Personal Background Context */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">個人背景資料</label>
        <textarea
          rows={3}
          value={contextSettings.personalBackground || contextSettings.environmentInfo || ''}
          onChange={e => {
            handleChange('personalBackground', e.target.value);
            handleChange('environmentInfo', e.target.value);
          }}
          placeholder="例如：我是生醫資訊領域研究員 / 專注於全端系統架構，日常偏好以專業工程視角切入分析..."
          className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500 resize-none text-[11px] leading-relaxed"
        />
      </div>

      {/* Custom instructions */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">自定義長期指令與原則 (Persona / Guidelines)</label>
        <textarea
          rows={3}
          value={contextSettings.customInstructions || ''}
          onChange={e => handleChange('customInstructions', e.target.value)}
          placeholder="例如：回答盡量使用繁體中文、遇代碼範例請加上詳細註解、避免主觀揣測..."
          className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500 resize-none text-[11px] leading-relaxed"
        />
      </div>
    </div>
  );
}
