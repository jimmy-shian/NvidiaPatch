import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Plus, Upload, Trash2, Edit3, RotateCcw, Check, X, FileCode, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

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

  const handleMoveUp = async (index) => {
    if (index <= 0 || !onReorderSkills) return;
    const newSkills = [...skills];
    const temp = newSkills[index - 1];
    newSkills[index - 1] = newSkills[index];
    newSkills[index] = temp;
    const newOrderedIds = newSkills.map(s => s.id);
    await onReorderSkills(newOrderedIds);
    setReorderFeedback(`已將「${newSkills[index - 1].name}」順序上移`);
    setTimeout(() => setReorderFeedback(null), 1500);
  };

  const handleMoveDown = async (index) => {
    if (index >= skills.length - 1 || !onReorderSkills) return;
    const newSkills = [...skills];
    const temp = newSkills[index + 1];
    newSkills[index + 1] = newSkills[index];
    newSkills[index] = temp;
    const newOrderedIds = newSkills.map(s => s.id);
    await onReorderSkills(newOrderedIds);
    setReorderFeedback(`已將「${newSkills[index + 1].name}」順序下移`);
    setTimeout(() => setReorderFeedback(null), 1500);
  };

  const handleMoveToTop = async (index) => {
    if (index <= 0 || !onReorderSkills) return;
    const newSkills = [...skills];
    const [target] = newSkills.splice(index, 1);
    newSkills.unshift(target);
    const newOrderedIds = newSkills.map(s => s.id);
    await onReorderSkills(newOrderedIds);
    setReorderFeedback(`已將「${target.name}」置頂為最高優先顯示`);
    setTimeout(() => setReorderFeedback(null), 1500);
  };


  const handleStartEdit = (skill) => {
    setEditingSkill({
      ...skill,
      rawContent: skill.rawContent || skill.instructions || ''
    });
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    setEditingSkill({
      id: '',
      name: '',
      description: '',
      icon: '⚡',
      toolsRequired: [],
      instructions: '',
      rawContent: ''
    });
    setIsCreating(true);
  };

  const handleSaveEdit = async () => {
    if (!editingSkill.name.trim()) return;
    const id = editingSkill.id.trim() || editingSkill.name.toLowerCase().replace(/\s+/g, '-');
    await onSaveSkill({
      ...editingSkill,
      id,
      instructions: editingSkill.rawContent || editingSkill.instructions
    });
    setEditingSkill(null);
    setIsCreating(false);
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

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white mb-0.5">{t('settings.skills.title')}</h4>
          <p className="text-slate-400 text-[11px]">{t('settings.skills.subtitle')}</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
          >
            <Upload size={12} />
            <span>{t('settings.skills.import')}</span>
          </button>
          <button
            onClick={handleStartCreate}
            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            <Plus size={13} />
            <span>{t('settings.skills.create')}</span>
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
          <span>顯示排序設定 (Display Priority)</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          您可以透過右側箭頭調整各項技能在對話輸入區的排列順序。排序前 4 項將優先直接顯示於對話選單首頁，其餘技能則可在展開「更多」時隨時點選。
        </p>
      </div>

      {/* Skills List with Display Rank and Order Actions */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {skills.map((skill, index) => (
          <div
            key={skill.id}
            className={`p-3 bg-slate-900/90 border rounded-xl flex flex-col gap-2 transition-all ${
              index < 4 ? 'border-emerald-500/30 shadow-sm' : 'border-slate-800'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Priority Rank Badge */}
                <div className={`w-5 h-5 rounded-lg flex items-center justify-center font-mono font-bold text-[10px] shrink-0 ${
                  index < 4
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {index + 1}
                </div>

                <span className="text-xl shrink-0">{skill.icon || '⚡'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-white text-xs">{skill.name}</span>
                    {index < 4 && (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[9px] font-sans font-medium">
                        優先顯示
                      </span>
                    )}
                    {skill.isBuiltin && !skill.isOverridden && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                        {t('settings.skills.builtinTag')}
                      </span>
                    )}
                    {skill.isOverridden && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono border border-amber-500/30">
                        {t('settings.skills.overriddenTag')}
                      </span>
                    )}
                    {skill.isCustom && !skill.isBuiltin && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono border border-emerald-500/30">
                        {t('settings.skills.customTag')}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5 line-clamp-1">{skill.description}</p>
                </div>
              </div>

              {/* Actions & Reordering Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Up/Down/Top sorting */}
                <div className="flex items-center bg-slate-950/70 border border-slate-800 rounded-lg p-0.5 mr-1">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-20 hover:bg-slate-800 rounded transition-colors"
                    title="順序上移"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === skills.length - 1}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-20 hover:bg-slate-800 rounded transition-colors"
                    title="順序下移"
                  >
                    <ArrowDown size={12} />
                  </button>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => handleMoveToTop(index)}
                      className="px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 rounded transition-colors"
                      title="直接置頂"
                    >
                      置頂
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleStartEdit(skill)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  title={t('settings.skills.edit')}
                >
                  <Edit3 size={13} />
                </button>

                {skill.isOverridden && (
                  <button
                    onClick={() => onDeleteSkill(skill.id)}
                    className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 transition-colors"
                    title={t('settings.skills.restore')}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}

                {skill.isCustom && !skill.isBuiltin && (
                  <button
                    onClick={() => onDeleteSkill(skill.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                    title={t('settings.skills.delete')}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>


      {/* Edit / Create Skill Modal */}
      {editingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#111827] border border-slate-700 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-white text-sm">
                {isCreating ? t('settings.skills.create') : `${t('settings.skills.edit')}: ${editingSkill.name}`}
              </h4>
              <button onClick={() => setEditingSkill(null)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">{t('settings.skills.skillName')}</label>
              <input
                type="text"
                value={editingSkill.name}
                onChange={e => setEditingSkill({ ...editingSkill, name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">{t('settings.skills.skillDescription')}</label>
              <input
                type="text"
                value={editingSkill.description}
                onChange={e => setEditingSkill({ ...editingSkill, description: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">{t('settings.skills.skillContent')}</label>
              <textarea
                rows={8}
                value={editingSkill.rawContent || editingSkill.instructions || ''}
                onChange={e => setEditingSkill({ ...editingSkill, rawContent: e.target.value, instructions: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono text-[11px] outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setEditingSkill(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-medium"
              >
                {t('app.cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold"
              >
                {t('app.save')}
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
              <h4 className="font-bold text-white text-sm">{t('settings.skills.import')}</h4>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Upload .md File</label>
              <input
                type="file"
                accept=".md,.txt"
                onChange={handleFileUpload}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-slate-300 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:text-xs"
              />
            </div>

            <div className="text-center text-slate-500 text-[11px]">OR</div>

            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Paste Skill Markdown</label>
              <textarea
                rows={6}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder="---\nname: my-skill\ndescription: ...\n---\n# Instructions..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-white font-mono text-[11px] outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-medium"
              >
                {t('app.cancel')}
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!importText.trim()}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold disabled:opacity-40"
              >
                {t('settings.skills.import')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
