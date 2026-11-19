import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus, Trash2, Check, X, Play, Sparkles, Loader2, Pin, MessageSquare, History, ChevronDown, ChevronRight } from 'lucide-react';
import { useScheduledTasks } from '../../hooks/useScheduledTasks';
import { getSkillDisplayName } from '../Chat/ChatInput';
import { formatScheduleRunTitle } from '../../core/schedule/scheduleEngine';

export default function ScheduleTasksPanel({
  providerConfigs,
  skills = [],
  currentProviderId,
  currentModelId,
  scheduledTasks: passedScheduledTasks,
  conversations = [],
  onSelectConversation,
  onCloseDrawer,
  highlightedTaskId = null
}) {
  const { t } = useTranslation();
  
  // Use passed scheduledTasks from App root if provided, otherwise fallback to local hook
  const localScheduledTasks = useScheduledTasks({
    providerConfigs,
    skills,
    isReady: !passedScheduledTasks
  });
  const {
    tasks,
    isLoading,
    selectedWidgetTaskId,
    selectTaskForWidget,
    saveTask,
    deleteTask,
    toggleTask,
    executeTaskNow
  } = passedScheduledTasks || localScheduledTasks;

  const [editingTask, setEditingTask] = useState(null); // 'new' | taskId | null
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [time, setTime] = useState('08:00');
  const [repeat, setRepeat] = useState('daily');
  const [selectedSkills, setSelectedSkills] = useState(['daily-fortune']);
  const [pinToWidget, setPinToWidget] = useState(true);
  const [includeHistoryContext, setIncludeHistoryContext] = useState(false);
  const [expandedHistoryTaskIds, setExpandedHistoryTaskIds] = useState({});
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [executingTaskId, setExecutingTaskId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const effectiveWidgetTaskId = selectedWidgetTaskId || tasks[0]?.id || null;

  const toggleHistoryExpanded = (taskId, e) => {
    e?.stopPropagation?.();
    setExpandedHistoryTaskIds(prev => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };

  const getMergedRunHistory = (task) => {
    const historyList = Array.isArray(task.runHistory) ? [...task.runHistory] : [];
    const seenConvIds = new Set(historyList.map(r => r?.conversationId).filter(Boolean));
    const seenRunIds = new Set(historyList.map(r => r?.runId).filter(Boolean));

    for (const conv of conversations) {
      if (!conv) continue;
      const belongsToTask =
        conv.scheduleId === task.id ||
        conv.taskId === task.id ||
        (task.conversationId && conv.id === task.conversationId);
      if (!belongsToTask) continue;
      if (seenConvIds.has(conv.id)) continue;
      if (conv.runId && seenRunIds.has(conv.runId)) continue;

      const execTime = conv.executedAt || conv.createdAt || conv.updatedAt || Date.now();
      historyList.push({
        scheduleId: task.id,
        runId: conv.runId || `legacy_${conv.id}`,
        conversationId: conv.id,
        title: conv.historyTitle || formatScheduleRunTitle(task.name, execTime),
        executedAt: execTime,
        completedAt: conv.completedAt || conv.updatedAt || execTime,
        status: conv.status || 'success',
        summary: conv.summary || ''
      });
      seenConvIds.add(conv.id);
    }

    return historyList.sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0));
  };

  const handleOpenNew = () => {
    setEditingTask('new');
    setName('晨間每日運勢');
    setPrompt('根據我的生肖與干支，分析今日吉凶、值神與出行注意事項。');
    setTime('07:30');
    setRepeat('daily');
    setSelectedSkills(['daily-fortune']);
    setPinToWidget(true);
    setIncludeHistoryContext(false);
  };

  const handleOpenEdit = (task) => {
    setEditingTask(task.id);
    setName(task.name);
    setPrompt(task.prompt);
    setTime(task.time || '08:00');
    setRepeat(task.repeat || 'daily');
    setSelectedSkills(task.skillIds || ['daily-fortune']);
    setPinToWidget(effectiveWidgetTaskId === task.id);
    setIncludeHistoryContext(Boolean(task.includeHistoryContext));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || isSaving) return;

    try {
      setIsSaving(true);
      await saveTask({
        id: editingTask === 'new' ? null : editingTask,
        name: name.trim(),
        prompt: prompt.trim(),
        time,
        repeat,
        skillIds: selectedSkills,
        providerId: currentProviderId || 'nvidia',
        modelId: currentModelId || '',
        pinToWidget,
        includeHistoryContext
      });
      setEditingTask(null);
    } catch (err) {
      console.warn('Save scheduled task error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualRun = async (task, e) => {
    e?.stopPropagation?.();
    if (executingTaskId || !executeTaskNow) return;
    try {
      setExecutingTaskId(task.id);
      await executeTaskNow(task);
    } catch (err) {
      console.warn('Manual run task error:', err);
    } finally {
      setExecutingTaskId(null);
    }
  };

  const formatNextRun = (timestamp) => {
    if (!timestamp) return '未排程';
    const d = new Date(timestamp);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  };

  const isNew = editingTask === 'new';

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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
        >
          <Plus size={13} />
          <span>新增任務</span>
        </button>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-slate-500 space-y-1.5">
            <Clock size={28} className="mx-auto text-slate-600 mb-1 animate-pulse" />
            <p className="font-medium text-slate-400">目前尚無排程任務</p>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              點擊上方「新增任務」，設定每天早晨或特定時間自動詢問 AI 並推播結果。
            </p>
          </div>
        ) : (
          tasks.map(task => {
            const isDeleting = deletingTaskId === task.id;
            const isTaskRunning = executingTaskId === task.id;

            if (isDeleting) {
              return (
                <div
                  key={task.id}
                  className="p-3 rounded-2xl bg-rose-950/70 border border-rose-800/80 text-xs flex flex-col gap-2 animate-fade-in shadow-lg"
                >
                  <div className="flex items-center gap-1.5 text-rose-300 font-semibold">
                    <Trash2 size={14} className="shrink-0 text-rose-400" />
                    <span className="truncate">確定刪除「{task.name}」？</span>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setDeletingTaskId(null)}
                      className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteTask(task.id);
                        setDeletingTaskId(null);
                      }}
                      className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-md transition-colors"
                    >
                      確定刪除
                    </button>
                  </div>
                </div>
              );
            }

            const isPinnedWidget = effectiveWidgetTaskId === task.id;
            const isHighlighted = highlightedTaskId === task.id;
            const latestResult = task.latestResult || null;
            const latestConvId = latestResult?.conversationId || task.conversationId || null;
            const latestSummary = latestResult?.summary || task.lastRunSummary || '';
            const latestStatus = latestResult?.status || task.lastRunStatus || null;
            const runHistoryList = getMergedRunHistory(task);
            const isHistoryExpanded = Boolean(expandedHistoryTaskIds[task.id]);

            return (
              <div
                key={task.id}
                className={`p-3 rounded-2xl border transition-all ${
                  isHighlighted ? 'ring-2 ring-amber-400/80 ' : ''
                }${
                  task.enabled
                    ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700 shadow-sm'
                    : 'bg-slate-950/40 border-slate-900 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="flex-1 min-w-0 cursor-pointer group"
                    onClick={() => handleOpenEdit(task)}
                    title="點擊編輯此任務"
                  >
                    <span className="font-semibold text-slate-200 break-words block group-hover:text-emerald-300 transition-colors">
                      {task.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Manual Run Now Button */}
                    <button
                      type="button"
                      onClick={(e) => handleManualRun(task, e)}
                      disabled={isTaskRunning || !task.enabled}
                      className="p-1.5 text-slate-400 hover:text-emerald-300 rounded-lg hover:bg-emerald-950/40 transition-colors disabled:opacity-40"
                      title="立即執行一次"
                    >
                      {isTaskRunning ? (
                        <Loader2 size={13} className="animate-spin text-emerald-400" />
                      ) : (
                        <Play size={13} />
                      )}
                    </button>

                    {/* Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id, !task.enabled)}
                      className={`w-8 h-4.5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                        task.enabled ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'
                      }`}
                      title={task.enabled ? "點擊停用此排程" : "點擊啟用此排程"}
                    >
                      <div className="w-3.5 h-3.5 rounded-full bg-white shadow-sm" />
                    </button>

                    {/* Delete Trigger */}
                    <button
                      type="button"
                      onClick={() => setDeletingTaskId(task.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 transition-colors"
                      title="刪除排程"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-1.5 flex items-center justify-between flex-wrap text-[10px] text-slate-500 pt-1.5 border-t border-slate-800/60 gap-x-2 gap-y-1">
                  <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                    <span className="font-mono text-amber-400 font-bold bg-amber-950/60 border border-amber-800/50 px-1.5 py-0.5 rounded-md shrink-0">
                      ⏰ {task.time}
                    </span>
                    <span className="text-slate-400">
{task.repeat === 'daily' ? '每天' : task.repeat === 'once' ? '僅一次' : '工作日'} · 下次: {formatNextRun(task.nextRunAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {task.lastRunStatus === 'success' && (
                      <span className="text-emerald-400">✅ {t('schedule.statusDone', '完成')}</span>
                    )}
                    {task.lastRunStatus === 'failed' && (
                      <span className="text-rose-400">⚠️ {t('schedule.statusFailed', '失敗')}</span>
                    )}
                    {task.skillIds && task.skillIds.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-slate-800/80 text-slate-300 border border-slate-700/50">
                        {task.skillIds[0]}
                      </span>
                    )}
                  </div>
                </div>

                {/* Latest Result Summary Preview */}
                {(latestSummary || latestStatus) && (
                  <div
                    className={`mt-2 px-2.5 py-1.5 rounded-xl border text-[11px] leading-snug ${
                      latestStatus === 'failed'
                        ? 'bg-rose-950/30 border-rose-800/40 text-rose-200'
                        : 'bg-slate-950/70 border-slate-800/70 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 mb-0.5">
                      <span>{t('schedule.latestSummaryLabel', '最新結果')}</span>
                      {task.lastRunAt && (
                        <span className="font-mono">{formatNextRun(task.lastRunAt)}</span>
                      )}
                    </div>
                    <p className="break-words line-clamp-2">
                      {latestSummary || (latestStatus === 'failed' ? '⚠️ 排程執行失敗' : '排程任務已完成')}
                    </p>
                  </div>
                )}

                {/* Widget Bind, View Latest Result & History Actions */}
                <div className="mt-2 flex items-center justify-between flex-wrap gap-1.5 pt-1.5 border-t border-slate-800/40">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectTaskForWidget?.(task.id);
                      }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
                        isPinnedWidget
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                      }`}
                    >
                      <Pin size={10} />
                      <span>{isPinnedWidget ? t('schedule.widgetPinned', '小工具顯示中') : t('schedule.pinToWidget', '設為小工具')}</span>
                    </button>

                    {runHistoryList.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => toggleHistoryExpanded(task.id, e)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-800/70 text-slate-300 hover:text-white border border-slate-700/50 transition-colors cursor-pointer"
                      >
                        <History size={10} />
                        <span>{t('schedule.historyRecords', '歷史紀錄')} ({runHistoryList.length})</span>
                        {isHistoryExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      </button>
                    )}
                  </div>

                  {latestConvId && onSelectConversation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectConversation(latestConvId, { forceReload: true });
                        onCloseDrawer?.();
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 transition-colors cursor-pointer"
                    >
                      <MessageSquare size={10} />
                      <span>{t('schedule.viewLatestResult', '查看最新結果')}</span>
                    </button>
                  )}
                </div>

                {/* Expandable Run History List (Dated Records) */}
                {isHistoryExpanded && runHistoryList.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800/60 space-y-1.5">
                    {runHistoryList.map((run, rIdx) => {
                      const runConvId = run.conversationId;
                      const displayTitle = run.title || formatScheduleRunTitle(task.name, run.executedAt);
                      const isRunFailed = run.status === 'failed';
                      return (
                        <button
                          key={run.runId || runConvId || rIdx}
                          type="button"
                          disabled={!runConvId || !onSelectConversation}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (runConvId && onSelectConversation) {
                              onSelectConversation(runConvId, { forceReload: true });
                              onCloseDrawer?.();
                            }
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800/80 transition-colors disabled:opacity-60 cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="font-medium text-slate-200 truncate">{displayTitle}</span>
                            <span className={isRunFailed ? 'text-rose-400 shrink-0' : 'text-emerald-400 shrink-0'}>
                              {isRunFailed ? '⚠️ 失敗' : '✅ 完成'}
                            </span>
                          </div>
                          {run.summary && (
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">{run.summary}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Widget Explanation Note */}
      <div className="p-3 rounded-2xl bg-amber-950/20 border border-amber-800/30 text-[11px] text-amber-300/80 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-amber-200">
          <Sparkles size={12} className="text-amber-400" />
          <span>背景執行與桌面小工具連動</span>
        </div>
        <p className="leading-relaxed">
          排程時間抵達時將自動於背景喚醒並執行分析，結果即時發送手機通知並同步至 Android 桌面小工具。
        </p>
      </div>

      {/* Enlarged Centered Modal Dialog for Task Creation & Editing */}
      {editingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setEditingTask(null)}
        >
          <div
            className="relative w-full max-w-lg bg-[#0f172a] border border-slate-700/80 rounded-3xl shadow-2xl p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white font-sans tracking-wide">
                {isNew ? '新增' : '編輯'}
              </h3>

              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="關閉彈窗"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  任務名稱
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例如: 每日晨間運勢、下班覆盤分析..."
                  className="w-full bg-black/60 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 transition-colors shadow-inner"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  提示詞描述 (Prompt - 時間到時將自動向 AI 發送)
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="請在此輸入要發送給 AI 的完整問題或分析要求..."
                  rows={3}
                  className="w-full bg-black/60 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 transition-colors shadow-inner resize-none leading-relaxed"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    觸發時間 (24小時制)
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className="w-full bg-black/60 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 transition-colors font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    重複頻率
                  </label>
                  <select
                    value={repeat}
                    onChange={e => setRepeat(e.target.value)}
                    className="w-full bg-black/60 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 transition-colors"
                  >
                    <option value="daily">每天執行一次</option>
                    <option value="weekly:1,2,3,4,5">工作日 (週一至五)</option>
                    <option value="once">僅執行一次 (執行後自動關閉)</option>
                  </select>
                </div>
              </div>

              {/* Bound Skills Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  綁定專業技能 (可複選)
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 bg-black/40 rounded-xl border border-slate-800">
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
                        className={`px-3 py-1.5 rounded-xl text-xs border transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-emerald-500/25 border-emerald-500 text-emerald-200 font-semibold shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <span>{s.icon || '⚡'}</span>
                        <span>{getSkillDisplayName(s)}</span>
                        {isSelected && <Check size={12} className="text-emerald-400 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pinToWidget}
                  onChange={e => setPinToWidget(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded"
                />
                <span className="text-xs text-slate-200 font-medium">
                  {t('schedule.pinWidgetCheckbox', '同步至桌面小工具')}
                </span>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeHistoryContext}
                  onChange={e => setIncludeHistoryContext(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded"
                />
                <span className="text-xs text-slate-200 font-medium">
                  {t('schedule.includeHistoryCheckbox', '引用前次排程摘要作為上下文（預設關閉）')}
                </span>
              </label>

              {/* Modal Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => {
                      const taskToRun = tasks.find(t => t.id === editingTask);
                      if (taskToRun) {
                        handleManualRun(taskToRun);
                        setEditingTask(null);
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-800/40 text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <Play size={13} />
                    <span>立即測試</span>
                  </button>
                )}

                <div className="flex items-center gap-2.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setEditingTask(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg shadow-emerald-950/40 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>儲存中…</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>{isNew ? '確認新增' : '儲存'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
