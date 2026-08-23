import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Plus, Upload, Trash2, Edit3, RotateCcw, Check, X, FileCode } from 'lucide-react';

export default function SkillsManagerTab({
  skills = [],
  onImportSkill,
  onSaveSkill,
  onDeleteSkill
}) {
  const { t } = useTranslation();
  const [editingSkill, setEditingSkill] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

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

      {/* Skills List */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {skills.map(skill => (
          <div
            key={skill.id}
            className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl flex flex-col gap-2"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{skill.icon || '⚡'}</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white text-xs">{skill.name}</span>
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

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleStartEdit(skill)}
                  className="p-1 text-slate-400 hover:text-white"
                  title={t('settings.skills.edit')}
                >
                  <Edit3 size={13} />
                </button>

                {skill.isOverridden && (
                  <button
                    onClick={() => onDeleteSkill(skill.id)}
                    className="p-1 text-amber-400 hover:text-amber-300"
                    title={t('settings.skills.restore')}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}

                {skill.isCustom && !skill.isBuiltin && (
                  <button
                    onClick={() => onDeleteSkill(skill.id)}
                    className="p-1 text-slate-500 hover:text-rose-400"
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
