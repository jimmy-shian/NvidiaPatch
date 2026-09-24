import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Plus,
  Upload,
  Trash2,
  Edit3,
  RotateCcw,
  Check,
  X,
  GripVertical,
  ArrowUpDown
} from 'lucide-react';

const SKILL_ZH_FALLBACKS = {
  bazi: '八字命理',
  ziwei: '紫微斗數',
  tarot: '經典塔羅',
  qimen: '奇門遁甲',
  liuyao: '六爻納甲',
  jingqian: '文王金錢卦',
  'daily-fortune': '每日運勢',
  dream: '周公解夢',
  naming: '生辰八字取名'
};

export default function SkillsManagerTab({
  skills = [],
  onImportSkill,
  onSaveSkill,
  onDeleteSkill,
  onReorderSkills
}) {
  const { t } = useTranslation();
  const [editingSkill, setEditingSkill] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [reorderFeedback, setReorderFeedback] = useState(null);
  const [confirmingSkillId, setConfirmingSkillId] = useState(null);

  // Drag and Drop state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const touchStartYRef = useRef(0);
  const touchDraggedIndexRef = useRef(null);

  // Filter out 'meihua' as it has its own dedicated chat
  const displaySkills = skills.filter(s => s.id !== 'meihua');

  const getSkillDisplayNameZh = (skill) => {
    return skill.nameZh || SKILL_ZH_FALLBACKS[skill.id] || skill.name || skill.id;
  };

  const getSkillDisplayNameEn = (skill) => {
    return skill.nameEn || (skill.name !== skill.nameZh ? skill.name : '') || skill.id;
  };

  const handleStartEdit = (skill) => {
    setEditingSkill({
      ...skill,
      nameZh: getSkillDisplayNameZh(skill),
      nameEn: getSkillDisplayNameEn(skill),
      rawContent: skill.rawContent || skill.instructions || ''
    });
    setIsCreating(false);
    setConfirmingSkillId(null);
  };

  const handleStartCreate = () => {
    setEditingSkill({
      id: '',
      nameZh: '',
      nameEn: '',
      name: '',
      description: '',
      icon: '⚡',
      toolsRequired: [],
      instructions: '',
      rawContent: ''
    });
    setIsCreating(true);
    setConfirmingSkillId(null);
  };

  const handleSaveEdit = async () => {
    const nameZh = editingSkill.nameZh?.trim() || '';
    const nameEn = editingSkill.nameEn?.trim() || '';
    const rawId = editingSkill.id?.trim() || '';
    const finalId = rawId || (nameEn ? nameEn.toLowerCase().replace(/\s+/g, '-') : '') || `skill_${Date.now()}`;
    const finalName = nameZh || nameEn || finalId;

    if (!finalName) return;

    await onSaveSkill({
      ...editingSkill,
      id: finalId,
      name: finalName,
      nameZh: nameZh || finalName,
      nameEn: nameEn || finalId,
      instructions: editingSkill.rawContent || editingSkill.instructions || ''
    });
    setEditingSkill(null);
    setIsCreating(false);
  };

  const handleConfirmAction = async (skillId, actionType) => {
    setConfirmingSkillId(null);
    if (onDeleteSkill) {
      await onDeleteSkill(skillId);
    }
  };

  const handleImportSubmit = async () => {
    if (!importText.trim()) return;
    await onImportSkill(importText);
    setImportText('');
    setShowImportModal(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        await onImportSkill(content, file.name.replace(/\.md$/, ''));
        setShowImportModal(false);
      }
    };
    reader.readAsText(file);
  };

  // Reorder handler
  const reorderList = async (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex === null || toIndex === null) return;
    const updated = [...displaySkills];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    const orderedIds = updated.map(s => s.id);
    if (onReorderSkills) {
      await onReorderSkills(orderedIds);
    }
    const movedName = getSkillDisplayNameZh(moved);
    setReorderFeedback(`已將「${movedName}」順序調整至第 ${toIndex + 1} 位`);
    setTimeout(() => setReorderFeedback(null), 1500);
  };

  // Drag handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = async (e, targetIndex) => {
    e.preventDefault();
    const sourceIndex = draggedIndex ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (!isNaN(sourceIndex) && sourceIndex !== targetIndex) {
      await reorderList(sourceIndex, targetIndex);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Touch handlers for mobile touch drag
  const handleTouchStart = (index, e) => {
    touchStartYRef.current = e.touches[0].clientY;
    touchDraggedIndexRef.current = index;
    setDraggedIndex(index);
  };

  const handleTouchEnd = async (e) => {
    const sourceIndex = touchDraggedIndexRef.current;
    if (sourceIndex === null || sourceIndex === undefined) return;

    const touchEndY = e.changedTouches[0].clientY;
    const diffY = touchEndY - touchStartYRef.current;
    const itemHeight = 72; // approximate item height
    const moveOffset = Math.round(diffY / itemHeight);

    if (moveOffset !== 0) {
      const targetIndex = Math.max(0, Math.min(displaySkills.length - 1, sourceIndex + moveOffset));
      if (targetIndex !== sourceIndex) {
        await reorderList(sourceIndex, targetIndex);
      }
    }

    touchDraggedIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white mb-0.5">{t('settings.skills.title', '技能設定')}</h4>
          <p className="text-slate-400 text-[11px]">{t('settings.skills.subtitle', '管理對話中啟用的專業技能模組')}</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
          >
            <Upload size={12} />
            <span>{t('settings.skills.import', '匯入')}</span>
          </button>
          <button
            onClick={handleStartCreate}
            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            <span>{t('settings.skills.create', '新建技能')}</span>
          </button>
        </div>
      </div>

      {/* Reorder feedback banner */}
      {reorderFeedback && (
        <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 text-xs flex items-center gap-1.5 animate-fade-in shadow-sm">
          <Check size={14} className="text-emerald-400" />
          <span>{reorderFeedback}</span>
        </div>
      )}

      {/* Display Order Guidance Box */}
      <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1 text-slate-300">
        <div className="flex items-center gap-1.5 font-semibold text-white">
          <ArrowUpDown size={13} className="text-emerald-400" />
          <span>顯示排序設定 (長按或拖曳調整)</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          長按或拖曳左側 <GripVertical size={11} className="inline text-slate-400" /> 圖示可調整排列順序。排序前 4 項將優先直接顯示於對話選單首頁。梅花易數已獨立為專屬對話模式，不在此處排序。
        </p>
      </div>

      {/* Skills List with Drag & Drop and Bilingual Layout */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {displaySkills.map((skill, index) => {
          const displayNameZh = getSkillDisplayNameZh(skill);
          const displayNameEn = getSkillDisplayNameEn(skill);
          const isDragging = draggedIndex === index;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={skill.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`p-3 bg-slate-900/90 border rounded-xl flex flex-col gap-2 transition-all ${
                isDragging ? 'opacity-40 border-dashed border-emerald-400' : ''
              } ${
                isDragOver ? 'border-emerald-500 bg-emerald-950/20' : ''
              } ${
                !isDragging && !isDragOver
                  ? index < 4
                    ? 'border-emerald-500/30 shadow-sm'
                    : 'border-slate-800'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {/* Drag Handle + Priority Rank Badge */}
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <div
                      onTouchStart={(e) => handleTouchStart(index, e)}
                      onTouchEnd={handleTouchEnd}
                      className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 p-0.5 rounded touch-none"
                      title="長按或拖曳調整順序"
                    >
                      <GripVertical size={15} />
                    </div>
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center font-mono font-bold text-[10px] shrink-0 ${
                        index < 4
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {index + 1}
                    </div>
                  </div>

                  {/* Icon */}
                  <span className="text-xl shrink-0 pt-0.5">{skill.icon || '⚡'}</span>

                  {/* Bilingual Title, ID and Description */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {/* Line 1: Chinese Name (Priority Display) + Tags */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-white text-xs sm:text-sm">{displayNameZh}</span>
                      {index < 4 && (
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[9px] font-sans font-medium">
                          優先顯示
                        </span>
                      )}
                      {skill.isBuiltin && !skill.isOverridden && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                          {t('settings.skills.builtinTag', '內建')}
                        </span>
                      )}
                      {skill.isOverridden && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono border border-amber-500/30">
                          {t('settings.skills.overriddenTag', '已覆寫')}
                        </span>
                      )}
                      {skill.isCustom && !skill.isBuiltin && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono border border-emerald-500/30">
                          {t('settings.skills.customTag', '自訂')}
                        </span>
                      )}
                    </div>

                    {/* Line 2: English Name / Identifier */}
                    {displayNameEn && (
                      <div className="text-[11px] font-mono text-slate-400 leading-tight">
                        {displayNameEn}
                      </div>
                    )}

                    {/* Line 3: Detailed Description */}
                    {skill.description && (
                      <p className="text-slate-400 text-[11px] leading-relaxed line-clamp-2 pt-0.5">
                        {skill.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions: Edit + Restore/Delete with Confirmation */}
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <button
                    onClick={() => handleStartEdit(skill)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    title={t('settings.skills.edit', '編輯技能')}
                  >
                    <Edit3 size={14} />
                  </button>

                  {/* Restore Overridden Skill with Confirmation */}
                  {skill.isOverridden && (
                    confirmingSkillId === skill.id ? (
                      <div className="flex items-center gap-1 bg-amber-950/80 border border-amber-500/50 rounded-lg p-1 animate-fade-in">
                        <span className="text-[10px] text-amber-300">還原？</span>
                        <button
                          onClick={() => handleConfirmAction(skill.id, 'restore')}
                          className="px-1.5 py-0.5 rounded bg-amber-500 text-black text-[10px] font-bold hover:bg-amber-400"
                        >
                          確定
                        </button>
                        <button
                          onClick={() => setConfirmingSkillId(null)}
                          className="px-1 py-0.5 text-slate-400 hover:text-white text-[10px]"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingSkillId(skill.id)}
                        className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 transition-colors"
                        title={t('settings.skills.restore', '還原為內建預設手冊')}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )
                  )}

                  {/* Delete Custom Skill with Confirmation */}
                  {skill.isCustom && !skill.isBuiltin && (
                    confirmingSkillId === skill.id ? (
                      <div className="flex items-center gap-1 bg-rose-950/90 border border-rose-500/50 rounded-lg p-1 animate-fade-in">
                        <span className="text-[10px] text-rose-300">確定刪除？</span>
                        <button
                          onClick={() => handleConfirmAction(skill.id, 'delete')}
                          className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-500"
                        >
                          確定
                        </button>
                        <button
                          onClick={() => setConfirmingSkillId(null)}
                          className="px-1 py-0.5 text-slate-400 hover:text-white text-[10px]"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingSkillId(skill.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                        title={t('settings.skills.delete', '刪除技能')}
                      >
                        <Trash2 size={14} />
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit / Create Skill Modal with Bilingual Input Fields */}
      {editingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#111827] border border-slate-700 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-white text-sm">
                {isCreating ? t('settings.skills.create', '新建技能') : `${t('settings.skills.edit', '編輯技能')}: ${editingSkill.nameZh || editingSkill.name}`}
              </h4>
              <button onClick={() => setEditingSkill(null)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {/* Bilingual Name Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-slate-300 font-semibold flex items-center gap-1">
                  <span>中文名稱</span>
                  <span className="text-[10px] text-emerald-400 font-normal">（優先顯示）</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：每日運勢大師"
                  value={editingSkill.nameZh || ''}
                  onChange={e => setEditingSkill({ ...editingSkill, nameZh: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-semibold flex items-center gap-1">
                  <span>英文 ID / 名稱</span>
                  <span className="text-[10px] text-slate-400 font-normal">（換行小字）</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：daily-fortune-master"
                  value={editingSkill.nameEn || editingSkill.id || ''}
                  onChange={e => setEditingSkill({ ...editingSkill, nameEn: e.target.value, id: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none font-mono text-xs"
                />
              </div>
            </div>

            {/* Icon & Description */}
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">{t('settings.skills.skillDescription', '技能說明')}</label>
              <input
                type="text"
                placeholder="簡短描述這項技能的用途與專長"
                value={editingSkill.description || ''}
                onChange={e => setEditingSkill({ ...editingSkill, description: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>

            {/* Prompt / Markdown Content */}
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">{t('settings.skills.skillContent', '技能手冊內容 (Markdown / Prompt)')}</label>
              <textarea
                rows={8}
                value={editingSkill.rawContent || editingSkill.instructions || ''}
                onChange={e => setEditingSkill({ ...editingSkill, rawContent: e.target.value, instructions: e.target.value })}
                placeholder="輸入技能系統提示詞或操作準則..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono text-[11px] outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setEditingSkill(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-medium hover:bg-slate-700 transition-colors"
              >
                {t('app.cancel', '取消')}
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold transition-colors"
              >
                {t('app.save', '儲存')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#111827] border border-slate-700 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-white text-sm">{t('settings.skills.import', '匯入技能')}</h4>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">上傳 .md 檔案</label>
              <input
                type="file"
                accept=".md,.txt"
                onChange={handleFileUpload}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-slate-300 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:text-xs"
              />
            </div>

            <div className="text-center text-slate-500 text-[11px]">或</div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">貼上 Markdown 內容</label>
              <textarea
                rows={6}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder="---\nname: my-skill\nname_zh: 我的自訂技能\ndescription: ...\n---\n# Instructions..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-white font-mono text-[11px] outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-medium hover:bg-slate-700 transition-colors"
              >
                {t('app.cancel', '取消')}
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!importText.trim()}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold disabled:opacity-40 transition-colors"
              >
                {t('settings.skills.import', '匯入')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
