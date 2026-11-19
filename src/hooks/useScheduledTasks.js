import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalDB } from '../core/storage/localDatabase';
import {
  calculateNextRunTime,
  executeScheduledTask,
  advanceStaleTask,
  isTaskExecuting,
  getSelectedWidgetTaskId,
  setSelectedWidgetTaskId,
  syncWidgetAndNativeSchedules,
  syncPendingNativeTaskResults
} from '../core/schedule/scheduleEngine';

export function useScheduledTasks({
  providerConfigs,
  skills = [],
  onSimulateChat = null,
  onCloseDrawer = null,
  isReady = true
}) {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWidgetTaskId, setSelectedWidgetTaskIdState] = useState(null);
  const isCheckingRef = useRef(false);
  const exactTimeoutRef = useRef(null);

  const providerConfigsRef = useRef(providerConfigs);
  providerConfigsRef.current = providerConfigs;

  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  const onSimulateChatRef = useRef(onSimulateChat);
  onSimulateChatRef.current = onSimulateChat;

  const onCloseDrawerRef = useRef(onCloseDrawer);
  onCloseDrawerRef.current = onCloseDrawer;

  const selectedWidgetTaskIdRef = useRef(selectedWidgetTaskId);
  selectedWidgetTaskIdRef.current = selectedWidgetTaskId;

  const loadTasks = useCallback(async () => {
    try {
      await syncPendingNativeTaskResults();
      const all = await LocalDB.getScheduledTasks();
      const storedWidgetId = await getSelectedWidgetTaskId();
      const resolvedWidgetId = (storedWidgetId && all.some(t => t.id === storedWidgetId))
        ? storedWidgetId
        : (all[0]?.id || null);
      setSelectedWidgetTaskIdState(resolvedWidgetId);
      setTasks(all);
      return all;
    } catch (e) {
      console.warn('[useScheduledTasks] Load tasks failed:', e);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const selectTaskForWidget = useCallback(async (taskId) => {
    const normalized = await setSelectedWidgetTaskId(taskId);
    setSelectedWidgetTaskIdState(normalized);
    await syncWidgetAndNativeSchedules({
      selectedTaskId: normalized,
      providerConfigs: providerConfigsRef.current,
      skills: skillsRef.current
    });
    return normalized;
  }, []);

  const saveTask = useCallback(async (taskData) => {
    const now = Date.now();
    const existing = taskData.id ? await LocalDB.getScheduledTask(taskData.id) : null;
    const nextRun = calculateNextRunTime(taskData.time, taskData.repeat);

    const taskId = taskData.id || `task_${now}`;
    const taskToSave = {
      ...(existing || {}),
      id: taskId,
      scheduleId: taskId,
      name: taskData.name || '我的排程任務',
      prompt: taskData.prompt || '',
      skillIds: taskData.skillIds || ['daily-fortune'],
      providerId: taskData.providerId || 'nvidia',
      modelId: taskData.modelId || '',
      time: taskData.time || '08:00',
      repeat: taskData.repeat || 'daily',
      enabled: taskData.enabled ?? existing?.enabled ?? true,
      includeHistoryContext: Boolean(taskData.includeHistoryContext ?? existing?.includeHistoryContext ?? false),
      lastRunAt: taskData.lastRunAt ?? existing?.lastRunAt ?? null,
      lastCompletedAt: taskData.lastCompletedAt ?? existing?.lastCompletedAt ?? null,
      lastRunStatus: taskData.lastRunStatus ?? existing?.lastRunStatus ?? null,
      lastRunSummary: taskData.lastRunSummary ?? existing?.lastRunSummary ?? null,
      lastRunFullContent: taskData.lastRunFullContent ?? existing?.lastRunFullContent ?? null,
      lastRunError: taskData.lastRunError ?? existing?.lastRunError ?? null,
      latestRunId: taskData.latestRunId ?? existing?.latestRunId ?? null,
      latestResult: taskData.latestResult ?? existing?.latestResult ?? null,
      runHistory: Array.isArray(taskData.runHistory)
        ? taskData.runHistory
        : (Array.isArray(existing?.runHistory) ? existing.runHistory : []),
      nextRunAt: nextRun,
      conversationId: taskData.conversationId ?? existing?.conversationId ?? null
    };

    const saved = await LocalDB.saveScheduledTask(taskToSave);
    const allTasks = await loadTasks();

    const currentWidgetId = selectedWidgetTaskIdRef.current || (await getSelectedWidgetTaskId());
    let targetWidgetId = currentWidgetId;
    if (taskData.pinToWidget === true || !currentWidgetId || !allTasks.some(t => t.id === currentWidgetId)) {
      targetWidgetId = saved.id;
      await setSelectedWidgetTaskId(targetWidgetId);
      setSelectedWidgetTaskIdState(targetWidgetId);
    }

    await syncWidgetAndNativeSchedules({
      tasks: allTasks,
      selectedTaskId: targetWidgetId,
      providerConfigs: providerConfigsRef.current,
      skills: skillsRef.current
    });
    return saved;
  }, [loadTasks]);

  const deleteTask = useCallback(async (id) => {
    await LocalDB.deleteScheduledTask(id);
    const allTasks = await loadTasks();
    const currentWidgetId = selectedWidgetTaskIdRef.current || (await getSelectedWidgetTaskId());
    let targetWidgetId = currentWidgetId;
    if (currentWidgetId === id || !allTasks.some(t => t.id === currentWidgetId)) {
      targetWidgetId = allTasks[0]?.id || null;
      await setSelectedWidgetTaskId(targetWidgetId);
      setSelectedWidgetTaskIdState(targetWidgetId);
    }
    await syncWidgetAndNativeSchedules({
      tasks: allTasks,
      selectedTaskId: targetWidgetId,
      providerConfigs: providerConfigsRef.current,
      skills: skillsRef.current
    });
  }, [loadTasks]);

  const toggleTask = useCallback(async (id, enabled) => {
    const task = await LocalDB.getScheduledTask(id);
    const nextRun = enabled && task
      ? calculateNextRunTime(task.time, task.repeat, new Date())
      : undefined;
    await LocalDB.toggleScheduledTask(id, enabled, nextRun);
    const allTasks = await loadTasks();
    await syncWidgetAndNativeSchedules({
      tasks: allTasks,
      providerConfigs: providerConfigsRef.current,
      skills: skillsRef.current
    });
  }, [loadTasks]);

  const executeTaskNow = useCallback(async (task) => {
    if (!task) return null;
    const res = await executeScheduledTask(task, {
      providerConfigs: providerConfigsRef.current,
      skills: skillsRef.current,
      onSimulateChat: onSimulateChatRef.current,
      force: true
    });
    await loadTasks();
    return res;
  }, [loadTasks]);

  // Keep native AlarmManager & AppWidget synced whenever settings become ready or change
  useEffect(() => {
    if (!isReady) return;
    syncWidgetAndNativeSchedules({
      providerConfigs,
      skills
    });
  }, [isReady, providerConfigs, skills]);

  // Periodic checker + exact next-run timer + native alarm/completion events
  useEffect(() => {
    if (!isReady) return;

    const scheduleExactTimer = (taskList) => {
      if (exactTimeoutRef.current) {
        clearTimeout(exactTimeoutRef.current);
        exactTimeoutRef.current = null;
      }
      const now = Date.now();
      let earliest = null;
      for (const t of taskList) {
        if (t.enabled && t.nextRunAt && t.nextRunAt > now) {
          if (earliest === null || t.nextRunAt < earliest) {
            earliest = t.nextRunAt;
          }
        }
      }
      if (earliest !== null) {
        // Clamp to max 24h to avoid 32-bit setTimeout overflow
        const delayMs = Math.min(Math.max(100, earliest - now + 150), 24 * 3600 * 1000);
        exactTimeoutRef.current = setTimeout(() => {
          checkAndExecuteDueTasks();
        }, delayMs);
      }
    };

    const checkAndExecuteDueTasks = async () => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const importedNative = await syncPendingNativeTaskResults();
        if (importedNative && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('localDbConversationsUpdated'));
        }

        const now = Date.now();
        const allTasks = await LocalDB.getScheduledTasks();
        let hasChanges = importedNative;

        for (const task of allTasks) {
          if (!task.enabled || !task.nextRunAt) continue;

          // Check if task is due
          if (task.nextRunAt <= now) {
            // Guard against stale tasks overdue by more than 4 hours (e.g. phone was powered off for a day)
            const isStale = (now - task.nextRunAt) > (4 * 3600 * 1000);
            if (isStale) {
              console.warn(`[useScheduledTasks] Task ${task.id} (${task.name}) is overdue by >4h, advancing to next cycle without late fire`);
              await advanceStaleTask(task, now);
              hasChanges = true;
            } else if (!isTaskExecuting(task.id)) {
              let claimedByNative = false;
              if (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.getNativeTaskStateJson === 'function') {
                try {
                  const stateRaw = window.NativeStreamBridge.getNativeTaskStateJson(task.id);
                  const nativeState = stateRaw ? JSON.parse(stateRaw) : null;
                  if (nativeState?.running) {
                    claimedByNative = true;
                  } else if (nativeState?.nextRunAt && nativeState.nextRunAt > (task.nextRunAt || 0)) {
                    // Native service already executed/advanced this schedule occurrence
                    await syncPendingNativeTaskResults();
                    await LocalDB.saveScheduledTask({
                      ...task,
                      nextRunAt: nativeState.nextRunAt,
                      lastRunAt: nativeState.lastRunAt || task.lastRunAt
                    });
                    claimedByNative = true;
                    hasChanges = true;
                  }
                } catch (_) {}
              }
              if (!claimedByNative) {
                await executeScheduledTask(task, {
                  providerConfigs: providerConfigsRef.current,
                  skills: skillsRef.current,
                  onSimulateChat: onSimulateChatRef.current
                });
                hasChanges = true;
              }
            }
          }
        }

        if (hasChanges) {
          const refreshed = await loadTasks();
          await syncWidgetAndNativeSchedules({
            tasks: refreshed,
            providerConfigs: providerConfigsRef.current,
            skills: skillsRef.current
          });
          scheduleExactTimer(refreshed);
        } else {
          scheduleExactTimer(allTasks);
        }
      } catch (err) {
        console.warn('[useScheduledTasks] Check due tasks error:', err);
      } finally {
        isCheckingRef.current = false;
      }
    };

    const timer = setInterval(checkAndExecuteDueTasks, 5000);
    checkAndExecuteDueTasks();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkAndExecuteDueTasks();
      }
    };
    const handleNativeEvent = () => {
      checkAndExecuteDueTasks();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('nativeAlarmTriggered', handleNativeEvent);
      window.addEventListener('nativeTaskCompleted', handleNativeEvent);
    }

    return () => {
      clearInterval(timer);
      if (exactTimeoutRef.current) {
        clearTimeout(exactTimeoutRef.current);
        exactTimeoutRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      if (typeof window !== 'undefined') {
        window.removeEventListener('nativeAlarmTriggered', handleNativeEvent);
        window.removeEventListener('nativeTaskCompleted', handleNativeEvent);
      }
    };
  }, [isReady, loadTasks]);

  return {
    tasks,
    isLoading,
    selectedWidgetTaskId,
    selectTaskForWidget,
    loadTasks,
    saveTask,
    deleteTask,
    toggleTask,
    executeTaskNow
  };
}
