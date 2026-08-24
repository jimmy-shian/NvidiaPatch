import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, Sparkles, ChevronDown, ChevronUp, X } from 'lucide-react';

export const SKILL_CHINESE_NAMES = {
  bazi: '八字命理占卜',
  ziwei: '紫微斗數論命',
  tarot: '經典塔羅解析',
  qimen: '奇門遁甲運籌',
  web_search: '網頁搜尋',
  code_interpreter: '程式分析',
  image_analysis: '圖片分析',
  document: '文件處理',
  data_analysis: '資料分析'
};

export function getSkillDisplayName(skill) {
  if (!skill) return '';
  if (SKILL_CHINESE_NAMES[skill.id]) return SKILL_CHINESE_NAMES[skill.id];
  if (skill.name && !/^[a-zA-Z0-9_-]+$/.test(skill.name)) return skill.name;
  return SKILL_CHINESE_NAMES[skill.name] || skill.name || skill.id;
}

export default function ChatInput({
  input,
  setInput,
  isStreaming,
  onSend,
  onStop,
  availableSkills = [],
  selectedSkillIds = [],
  onToggleSkill,
  disabled
}) {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const skillsContainerRef = useRef(null);
  const [isSkillsMenuOpen, setIsSkillsMenuOpen] = useState(false);

  // Auto resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 120; // 4-5 lines max
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [input]);

  // Click outside and Esc listener to automatically close skills menu
  useEffect(() => {
    if (!isSkillsMenuOpen) return;

    const handleDocumentClick = (e) => {
      if (skillsContainerRef.current && !skillsContainerRef.current.contains(e.target)) {
        setIsSkillsMenuOpen(false);
      }
    };

    const handleKeyDownEsc = (e) => {
      if (e.key === 'Escape') {
        setIsSkillsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('touchstart', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDownEsc);

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('touchstart', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDownEsc);
    };
  }, [isSkillsMenuOpen]);

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isStreaming && input.trim() && !disabled) {
        onSend();
      }
    }
  };

  const selectedCount = selectedSkillIds.length;

  return (
    <div className="w-full bg-[#0b0f17]/95 border-t border-slate-800/80 px-3 pt-2 pb-2 safe-area-bottom backdrop-blur-md relative">
      {/* Expandable Skills Selector Menu with Click-Outside Ref */}
      {availableSkills.length > 0 && (
        <div ref={skillsContainerRef} className="mb-2 relative">
          {/* Toggle Button */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsSkillsMenuOpen(prev => !prev)}
              disabled={isStreaming}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                selectedCount > 0
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles size={13} className={selectedCount > 0 ? "text-emerald-400" : "text-amber-400"} />
              <span>技能（已選擇 {selectedCount}）</span>
              {isSkillsMenuOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {/* Clear selection if any */}
            {selectedCount > 0 && isSkillsMenuOpen && (
              <button
                type="button"
                onClick={() => {
                  selectedSkillIds.forEach(id => onToggleSkill(id));
                }}
                className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors px-1"
              >
                清除所有勾選
              </button>
            )}
          </div>

          {/* Expanded Multiselect Dropdown */}
          {isSkillsMenuOpen && (
            <div className="absolute left-0 right-0 bottom-full mb-2 p-2.5 rounded-2xl bg-[#111827] border border-slate-700 shadow-2xl max-h-[45vh] overflow-y-auto space-y-1 animate-fade-in z-30">
              <div className="text-[11px] text-slate-400 px-1 pb-1 font-medium border-b border-slate-800/80 mb-1 flex items-center justify-between">
                <span>點擊勾選或取消技能（可複選）：</span>
                <button
                  type="button"
                  onClick={() => setIsSkillsMenuOpen(false)}
                  className="text-slate-400 hover:text-white p-0.5"
                >
                  <X size={13} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                {availableSkills.map(skill => {
                  const isChecked = selectedSkillIds.includes(skill.id);
                  const displayName = getSkillDisplayName(skill);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => onToggleSkill(skill.id)}
                      disabled={isStreaming}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-all border ${
                        isChecked
                          ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200 font-semibold shadow-sm'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span className="text-sm shrink-0">{skill.icon || '⚡'}</span>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{displayName}</span>
                          {skill.description && (
                            <span className="text-[10px] text-slate-400 truncate">{skill.description}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-emerald-400 ml-1">
                        {isChecked ? (
                          <div className="w-4 h-4 rounded bg-emerald-500 text-white flex items-center justify-center text-[10px]">
                            ✓
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded border border-slate-600 bg-black/40" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input box and action button */}
      <div className="flex items-end gap-2 bg-slate-900/90 border border-slate-800 focus-within:border-emerald-500/60 rounded-2xl p-1.5 transition-colors shadow-inner">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? t('chat.noModelSelected') : t('chat.inputPlaceholder')}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm px-3 py-1.5 resize-none outline-none max-h-[120px]"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="p-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium shadow-md shadow-rose-950/40 transition-transform active:scale-95 shrink-0"
            title={t('chat.stop')}
          >
            <Square size={16} className="fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || disabled}
            className={`p-2.5 rounded-xl text-white font-medium transition-all shrink-0 ${
              input.trim() && !disabled
                ? 'bg-emerald-500 hover:bg-emerald-400 shadow-md shadow-emerald-950/40 active:scale-95'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50'
            }`}
            title={t('chat.send')}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
