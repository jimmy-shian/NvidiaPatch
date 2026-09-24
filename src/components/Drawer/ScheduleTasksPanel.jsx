import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus, Trash2, Check, X, Bell, Play, Calendar, Sparkles } from 'lucide-react';
import { useScheduledTasks } from '../../hooks/useScheduledTasks';
import { getSkillDisplayName } from '../Chat/ChatInput';

export default function ScheduleTasksPanel({
  providerConfigs,
  skills = [],
  currentProviderId,
  currentModelId
}) {
  const { t } = useTranslation();
  const {
    tasks,
    isLoading,
    saveTask,
    deleteTask,
    toggleTask
  } = useScheduledTasks({ providerConfigs, skills });

  const [editingTask, setEditingTask] = useState(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [time, setTime] = useState('08:00');
  const [repeat, setRepeat] = useState('daily');
  const [selectedSkills, setSelectedSkills] = useState(['daily-fortune']);
  const [deletingTaskId, setDeletingTaskId] = useState(null);

  const handleOpenNew = () => {
    setEditingTask('new');
    setName('晨間每日運勢');
    setPrompt('根據我的生肖與干支，分析今日吉凶、值神與出行注意事項。');
    setTime('07:30');
    setRepeat('daily');
    setSelectedSkills(['daily-fortune']);
  };

  const handleOpenEdit = (task) => {
    setEditingTask(task.id);
    setName(task.name);
    setPrompt(task.prompt);
    setTime(task.time || '08:00');
    setRepeat(task.repeat || 'daily');
    setSelectedSkills(task.skillIds || ['daily-fortune']);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    await saveTask({
      id: editingTask === 'new' ? null : editingTask,
      name: name.trim(),
      prompt: prompt.trim(),
      time,
      repeat,
      skillIds: selectedSkills,
      providerId: currentProviderId || 'nvidia',
      modelId: currentModelId || ''
    });

    setEditingTask(null);
  };

  const formatNextRun = (timestamp) => {
    if (!timestamp) return '未定';
    const d = new Date(timestamp);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-3 py-2 space-y-3 text-xs">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
          <Clock size={14} className="text-amber-400" />
          <span>每日排程任務</span>
        </div>
        <button
          type="button"
          onClick={handleOpenNew}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[11px] transition-colors"
        >
          <Plus size={12} />
          <span>新增任務</span>
        </button>
      </div>

      {/* Editor Modal / Inline Form */}
      {editingTask && (
        <form onSubmit={handleSave} className="p-3 rounded-2xl bg-slate-900 border border-emerald-500/40 space-y-2.5 shadow-xl animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="font-bold text-emerald-300 text-xs">
              {editingTask === 'new' ? '✨ 新增排程任務' : '✏️ 編輯任務'}
            </span>
            <button
              type="button"
              onClick={() => setEditingTask(null)}
              className="text-slate-400 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">任務名稱</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: 每日運勢簡報"
              className="w-full bg-black/50 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 text-xs"
              required
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">提示詞描述 (Prompt)</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="時間到時要自動詢問 AI 的內容..."
              rows={2}
              className="w-full bg-black/50 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 text-xs resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">執行時間</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full bg-black/50 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 outline-none focus:border-emerald-500 text-xs font-mono"
                required
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">重複規則</label>
              <select
                value={repeat}
                onChange={e => setRepeat(e.target.value)}
                className="w-full bg-black/50 border border-slate-700 rounded-xl px-2 py-1.5 text-slate-100 outline-none focus:border-emerald-500 text-xs"
              >
                <option value="daily">每天執行一次</option>
                <option value="weekly:1,2,3,4,5">工作日 (週一至五)</option>
                <option value="once">僅執行一次</option>
              </select>
            </div>
          </div>

          {/* Bound Skills Selection */}
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">綁定技能 (預設每日運勢)</label>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pt-0.5">
              {skills.filter(s => s.id !== 'meihua').map(s => {
                const isSelected = selectedSkills.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedSkills(prev =>
                        prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id]
                      );
                    }}
                    className={`px-2 py-0.5 rounded-lg text-[10px] border transition-all ${
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200 font-semibold'
                        : 'bg-black/30 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>{s.icon || '⚡'} {getSkillDisplayName(s)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditingTask(null)}
              className="px-3 py-1 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md"
            >
              儲存任務
            </button>
          </div>
        </form>
      )}

      {/* Task List */}
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-center py-6 text-slate-500 space-y-1">
            <Clock size={24} className="mx-auto text-slate-600 mb-1" />
            <p>目前尚無排程任務</p>
            <p className="text-[10px]">點擊上方「新增任務」設定每天定時自動分析</p>
          </div>
        ) : (
          tasks.map(task => {
            const isDeleting = deletingTaskId === task.id;

            if (isDeleting) {
              return (
                <div
                  key={task.id}
                  className="p-2.5 rounded-2xl bg-rose-950/60 border border-rose-800/80 text-xs flex flex-col gap-1.5 animate-fade-in"
                >
                  <div className="flex items-center gap-1.5 text-rose-300 text-[11px] font-semibold">
                    <Trash2 size={13} className="shrink-0" />
                    <span className="truncate">確定刪除「{task.name}」？</span>
                  </div>
                  <div className="flex justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setDeletingTaskId(null)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteTask(task.id);
                        setDeletingTaskId(null);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] transition-colors shadow-sm"
                    >
                      確定刪除
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={task.id}
                className={`p-2.5 rounded-2xl border transition-all ${
                  task.enabled
                    ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-950/40 border-slate-900 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleOpenEdit(task)}
                  >
                    <span className="font-mono text-amber-400 font-bold text-xs shrink-0">
                      ⏰ {task.time}
                    </span>
                    <span className="font-semibold text-slate-200 truncate">
                      {task.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {/* Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id, !task.enabled)}
                      className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                        task.enabled ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingTaskId(task.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                      title="刪除排程"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="truncate max-w-[140px] text-slate-400">
                    {task.repeat === 'daily' ? '每天' : task.repeat === 'once' ? '僅一次' : '工作日'} · 下次: {formatNextRun(task.nextRunAt)}
                  </span>
                  {task.skillIds && task.skillIds.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                      {task.skillIds[0]}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Widget Explanation Note */}
      <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-800/30 text-[10px] text-amber-300/80 space-y-0.5">
        <div className="flex items-center gap-1 font-semibold text-amber-200">
          <Sparkles size={11} />
          <span>桌面小工具連動</span>
        </div>
        <p>排程執行後，回答摘要將自動發送推播通知並同步更新至 Android 桌面小工具。</p>
      </div>
    </div>
  );
}
