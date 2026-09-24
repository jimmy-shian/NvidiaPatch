import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, Sparkles, ChevronDown, ChevronUp, X, ImagePlus, Loader2 } from 'lucide-react';
import { processImageFile } from '../../core/utils/imageUtils';

export const SKILL_CHINESE_NAMES = {
  bazi: '八字命理占卜',
  ziwei: '紫微斗數論命',
  tarot: '經典塔羅解析',
  qimen: '奇門遁甲運籌',
  meihua: '梅花易數起卦',
  liuyao: '六爻納甲占斷',
  jingqian: '易經金錢卦',
  'daily-fortune': '每日運勢簡報',
  dream: '夢境解析',
  naming: '姓名學分析',
  web_search: '網頁搜尋',
  code_interpreter: '程式分析',
  image_analysis: '圖片分析',
  document: '文件處理',
  data_analysis: '資料分析'
};

export function getSkillDisplayName(skill) {
  if (!skill) return '';
  if (skill.nameZh) return skill.nameZh;
  if (SKILL_CHINESE_NAMES[skill.id]) return SKILL_CHINESE_NAMES[skill.id];
  if (skill.name && !/^[a-zA-Z0-9_\-\s]+$/.test(skill.name)) return skill.name;
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
  hideSkillsSelector = false,
  attachedImages = [],
  onAddImages,
  onRemoveImage,
  onClearImages,
  disabled
}) {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const skillsContainerRef = useRef(null);
  const [isSkillsMenuOpen, setIsSkillsMenuOpen] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

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

  const canSend = (input.trim().length > 0 || attachedImages.length > 0) && !disabled;

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isStreaming && canSend) {
        onSend();
      }
    }
  };

  const processAndAddFiles = async (files) => {
    if (!files || files.length === 0) return;
    setIsProcessingImage(true);
    try {
      const processedList = [];
      for (const file of files) {
        if (!file.type || !file.type.startsWith('image/')) continue;
        try {
          const imgObj = await processImageFile(file);
          processedList.push(imgObj);
        } catch (err) {
          console.error('Failed to process image file:', err);
        }
      }
      if (processedList.length > 0 && onAddImages) {
        onAddImages(processedList);
      }
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await processAndAddFiles(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = Array.from(clipboardData.items || []);
    const imageFiles = [];

    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await processAndAddFiles(imageFiles);
    }
  };

  // Priority skills count (top 4 skills are shown first by default)
  const PRIORITY_SKILLS_COUNT = 4;

  // In general chat, filter out 'meihua' since it is an independent dedicated chat mode
  const selectableSkills = (availableSkills || []).filter(s => s.id !== 'meihua');
  const validSelectedIds = selectedSkillIds.filter(id => id !== 'meihua');
  const selectedCount = validSelectedIds.length;

  // Split into priority skills and others
  const prioritySkills = selectableSkills.slice(0, PRIORITY_SKILLS_COUNT);
  const otherSkills = selectableSkills.slice(PRIORITY_SKILLS_COUNT);
  // Non-priority skills that are currently selected by the user
  const extraSelectedSkills = otherSkills.filter(s => validSelectedIds.includes(s.id));

  // Meihua numbers tag handling
  const meihuaMatch = input.match(/<meihua-numbers\s+n1="(\d+)"\s+n2="(\d+)"\s+n3="(\d+)"[^>]*>/i);
  const hasMeihuaNumbers = Boolean(meihuaMatch);
  const meihuaNumbers = meihuaMatch ? [meihuaMatch[1], meihuaMatch[2], meihuaMatch[3]] : null;

  const handleRemoveMeihuaNumbers = () => {
    setInput(prev => prev.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '').trim());
  };

  const cleanQuestionText = hasMeihuaNumbers
    ? input.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '').trimStart()
    : input;

  const handleTextareaChange = (e) => {
    const val = e.target.value;
    if (hasMeihuaNumbers) {
      setInput(`<meihua-numbers n1="${meihuaNumbers[0]}" n2="${meihuaNumbers[1]}" n3="${meihuaNumbers[2]}"></meihua-numbers> ${val}`);
    } else {
      setInput(val);
    }
  };

  return (
    <div className="w-full bg-[#0b0f17]/95 border-t border-slate-800/80 px-3 pt-2 pb-2 safe-area-bottom backdrop-blur-md relative">
      {/* Active Meihua numbers badge */}
      {hasMeihuaNumbers && (
        <div className="flex items-center gap-1.5 px-3 py-1 mb-2 rounded-xl bg-gradient-to-r from-rose-950/80 to-purple-950/80 border border-rose-500/40 text-rose-200 text-xs w-fit shadow-sm animate-fade-in">
          <span className="font-semibold text-rose-300 flex items-center gap-1">🎲 {t('meihua.seedBadge', '靈動數')}:</span>
          <span className="px-1.5 py-0.5 rounded bg-rose-900/60 border border-rose-700/50 font-mono font-bold text-rose-100 text-[11px]">
            {meihuaNumbers[0]}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-rose-900/60 border border-rose-700/50 font-mono font-bold text-rose-100 text-[11px]">
            {meihuaNumbers[1]}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-rose-900/60 border border-rose-700/50 font-mono font-bold text-rose-100 text-[11px]">
            {meihuaNumbers[2]}
          </span>
          <button
            type="button"
            onClick={handleRemoveMeihuaNumbers}
            className="ml-1 p-0.5 rounded-lg hover:bg-rose-800/60 text-rose-400 hover:text-white transition-colors"
            title={t('meihua.removeSeed', '移除靈動數（改用時間起卦）')}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Collapsed Skills Selector Menu with Click-Outside Ref */}
      {!hideSkillsSelector && selectableSkills.length > 0 && (
        <div ref={skillsContainerRef} className="mb-2 relative">
          {/* Collapsed Toggle Bar */}
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
              <span>{`技能（已選擇 ${selectedCount}）`}</span>
              {isSkillsMenuOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {/* Clear selection if any */}
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  validSelectedIds.forEach(id => onToggleSkill(id));
                }}
                className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors px-1"
                title="清除所有勾選技能"
              >
                {`清除勾選 (${selectedCount})`}
              </button>
            )}
          </div>

          {/* Expanded Multiselect Dropdown Panel */}
          {isSkillsMenuOpen && (
            <div className="absolute left-0 right-0 bottom-full mb-2 p-2.5 rounded-2xl bg-[#111827] border border-slate-700 shadow-2xl max-h-[48vh] overflow-y-auto space-y-1.5 animate-fade-in z-30">
              <div className="text-[11px] text-slate-400 px-1 pb-1 font-medium border-b border-slate-800/80 mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-200">所有技能清單</span>
                  <span className="text-[10px] text-slate-500">（依設定優先度排序）</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        validSelectedIds.forEach(id => onToggleSkill(id));
                      }}
                      className="text-[10px] text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      清除全部
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsSkillsMenuOpen(false)}
                    className="text-slate-400 hover:text-white p-0.5"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                {selectableSkills.map((skill, index) => {
                  const isChecked = validSelectedIds.includes(skill.id);
                  const isPriority = index < PRIORITY_SKILLS_COUNT;
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
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{displayName}</span>
                            {isPriority && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-normal">
                                優先
                              </span>
                            )}
                          </div>
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

      {/* Attached Images Preview Row */}
      {attachedImages.length > 0 && (
        <div className="flex items-center gap-2 mb-2 p-1.5 overflow-x-auto rounded-xl bg-slate-950/70 border border-slate-800/80 animate-fade-in">
          {attachedImages.map((img, idx) => (
            <div key={idx} className="relative group shrink-0">
              <img
                src={img.url}
                alt={`Preview ${idx + 1}`}
                className="w-14 h-14 object-cover rounded-lg border border-slate-700/80 shadow-sm"
              />
              <button
                type="button"
                onClick={() => onRemoveImage?.(idx)}
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-slate-900/90 hover:bg-rose-600 text-slate-300 hover:text-white border border-slate-700 shadow-sm transition-colors"
                title="移除圖片"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {attachedImages.length > 0 && (
            <button
              type="button"
              onClick={onClearImages}
              className="text-[11px] text-slate-400 hover:text-rose-400 px-2 py-1 shrink-0 transition-colors ml-auto"
            >
              清除全部 ({attachedImages.length})
            </button>
          )}
        </div>
      )}

      {/* Hidden File Input for Image Selection */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Input box and action button */}
      <div className="flex items-end gap-1.5 sm:gap-2 bg-slate-900/90 border border-slate-800 focus-within:border-emerald-500/60 rounded-2xl p-1.5 transition-colors shadow-inner">
        {/* Image Picker Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isStreaming || isProcessingImage}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 active:scale-95 transition-all shrink-0 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          title="選擇或上傳圖片（亦可直接剪貼簿貼上圖片）"
        >
          {isProcessingImage ? (
            <Loader2 size={18} className="animate-spin text-emerald-400" />
          ) : (
            <ImagePlus size={18} />
          )}
        </button>

        <textarea
          ref={textareaRef}
          value={cleanQuestionText}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={disabled ? t('chat.noModelSelected') : (attachedImages.length > 0 ? "輸入針對圖片的問題，或直接送出…" : t('chat.inputPlaceholder'))}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm px-2 sm:px-3 py-1.5 resize-none outline-none max-h-[120px]"
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
            disabled={!canSend}
            className={`p-2.5 rounded-xl text-white font-medium transition-all shrink-0 ${
              canSend
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
