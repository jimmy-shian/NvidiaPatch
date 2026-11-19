import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Globe, MessageSquare, Sparkles, FileText, ChevronDown, ChevronUp, Check, CheckCircle2 } from 'lucide-react';
import { SUPPORTED_LANGUAGES, SUPPORTED_STYLES } from '../../core/context/contextManager';

export default function PersonalContextTab({ contextSettings = {}, onUpdateContext }) {
  const { t } = useTranslation();
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const isEditingRef = useRef(false);
  const feedbackTimerRef = useRef(null);

  const [formData, setFormData] = useState(() => ({
    userName: contextSettings?.userName || '',
    responseLanguage: contextSettings?.responseLanguage || 'zh-TW',
    responseStyle: contextSettings?.responseStyle || 'balanced',
    personalBackground: contextSettings?.personalBackground || contextSettings?.environmentInfo || '',
    customInstructions: contextSettings?.customInstructions || ''
  }));

  // Synchronize when contextSettings loads asynchronously, unless user is actively typing
  useEffect(() => {
    if (!isEditingRef.current) {
      setFormData({
        userName: contextSettings?.userName || '',
        responseLanguage: contextSettings?.responseLanguage || 'zh-TW',
        responseStyle: contextSettings?.responseStyle || 'balanced',
        personalBackground: contextSettings?.personalBackground || contextSettings?.environmentInfo || '',
        customInstructions: contextSettings?.customInstructions || ''
      });
    }
  }, [contextSettings]);

  const triggerSaveFeedback = () => {
    setShowSavedFeedback(true);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setShowSavedFeedback(false);
    }, 1500);
  };

  const updateField = (field, value) => {
    isEditingRef.current = true;
    const next = {
      ...formData,
      [field]: value
    };
    if (field === 'personalBackground') {
      next.environmentInfo = value;
    }
    setFormData(next);
    onUpdateContext?.(next);
    triggerSaveFeedback();
  };

  const handleBlur = () => {
    isEditingRef.current = false;
  };

  const currentLangId = formData.responseLanguage || 'zh-TW';
  const selectedLangObj = SUPPORTED_LANGUAGES.find(l => l.id === currentLangId) || SUPPORTED_LANGUAGES[0];

  const handleLangSelect = (langId) => {
    setIsLangDropdownOpen(false);
    updateField('responseLanguage', langId);
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white mb-0.5">{t('settings.context.title', '個人背景設定')}</h4>
          <p className="text-slate-400 text-[11px]">{t('settings.context.subtitle', '對話時自動帶入稱謂、語言與回覆風格。')}</p>
        </div>
        {showSavedFeedback && (
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-1 rounded-lg animate-fade-in shrink-0">
            <CheckCircle2 size={12} />
            <span>{t('settings.context.autoSaved', '已儲存')}</span>
          </div>
        )}
      </div>

      {/* User Name */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">{t('settings.context.userName', '稱謂 / 暱稱')}</label>
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-emerald-500">
          <User size={14} className="text-slate-500 shrink-0" />
          <input
            type="text"
            value={formData.userName}
            onChange={e => updateField('userName', e.target.value)}
            onBlur={handleBlur}
            placeholder={t('settings.context.userNamePlaceholder', '例如：Alex')}
            className="w-full bg-transparent text-white outline-none text-xs"
          />
        </div>
      </div>

      {/* Response Language (100% Custom Dropdown Picker) */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">{t('settings.context.responseLanguage', '回答語言')}</label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsLangDropdownOpen(prev => !prev)}
            className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl px-3.5 py-2.5 text-left transition-colors focus:border-emerald-500 shadow-sm"
          >
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <Globe size={14} className="text-emerald-400 shrink-0" />
              <span className="font-semibold text-white text-xs truncate">
                {selectedLangObj.name}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({selectedLangObj.id})
              </span>
            </div>
            {isLangDropdownOpen ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
          </button>

          {isLangDropdownOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#111827] border border-slate-700 rounded-xl shadow-2xl z-30 p-1.5 space-y-1 animate-fade-in max-h-60 overflow-y-auto">
              {SUPPORTED_LANGUAGES.map(lang => {
                const isSelected = lang.id === currentLangId;
                return (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => handleLangSelect(lang.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-200 font-bold border border-emerald-500/40'
                        : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white font-medium truncate">{lang.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">({lang.id})</span>
                    </div>
                    {isSelected && <Check size={14} className="text-emerald-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Response Style */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">{t('settings.context.responseStyle', '回答風格')}</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SUPPORTED_STYLES.map(style => (
            <button
              key={style.id}
              type="button"
              onClick={() => updateField('responseStyle', style.id)}
              className={`py-2 px-2.5 rounded-xl border text-xs font-medium transition-all text-left flex flex-col gap-0.5 ${
                formData.responseStyle === style.id
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span className="font-semibold text-white">{t(`settings.context.styles.${style.id}.name`, style.name)}</span>
              <span className="text-[10px] opacity-75 line-clamp-1">
                {t(`settings.context.styles.${style.id}.desc`, style.id === 'adhd' ? '結論先行・條列精煉' : style.prompt.slice(0, 14) + '...')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Personal Background Context */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">{t('settings.context.environment', '個人背景')}</label>
        <textarea
          rows={3}
          value={formData.personalBackground}
          onChange={e => updateField('personalBackground', e.target.value)}
          onBlur={handleBlur}
          placeholder={t('settings.context.environmentPlaceholder', '例如：全端工程師、使用 Windows 11 / React 18...')}
          className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500 resize-none text-[11px] leading-relaxed"
        />
      </div>

      {/* Custom instructions */}
      <div className="space-y-1.5">
        <label className="block text-slate-300 font-semibold">{t('settings.context.instructions', '自訂長期指令')}</label>
        <textarea
          rows={3}
          value={formData.customInstructions}
          onChange={e => updateField('customInstructions', e.target.value)}
          onBlur={handleBlur}
          placeholder={t('settings.context.instructionsPlaceholder', '例如：程式碼附註解、避免主觀推測...')}
          className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500 resize-none text-[11px] leading-relaxed"
        />
      </div>
    </div>
  );
}
