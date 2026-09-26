import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalDB } from '../core/storage/localDatabase';
import { calculateNextRunTime, executeScheduledTask, advanceStaleTask, isTaskExecuting } from '../core/schedule/scheduleEngine';

export function useScheduledTasks({
  providerConfigs,
  skills = [],
  onSimulateChat = null,
  onCloseDrawer = null
}) {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const isCheckingRef = useRef(false);

  const providerConfigsRef = useRef(providerConfigs);
  providerConfigsRef.current = providerConfigs;

  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  const onSimulateChatRef = useRef(onSimulateChat);
  onSimulateChatRef.current = onSimulateChat;

  const onCloseDrawerRef = useRef(onCloseDrawer);
  onCloseDrawerRef.current = onCloseDrawer;

  const loadTasks = useCallback(async () => {
    try {
      const all = await LocalDB.getScheduledTasks();
      setTasks(all);
    } catch (e) {
      console.warn('[useScheduledTasks] Load tasks failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const saveTask = useCallback(async (taskData) => {
    const isNew = !taskData.id;
    const now = Date.now();
    const nextRun = calculateNextRunTime(taskData.time, taskData.repeat);

    const taskToSave = {
      id: taskData.id || `task_${now}`,
      name: taskData.name || '我的排程任務',
      prompt: taskData.prompt || '',
      skillIds: taskData.skillIds || ['daily-fortune'],
      providerId: taskData.providerId || 'nvidia',
      modelId: taskData.modelId || '',
      time: taskData.time || '08:00',
      repeat: taskData.repeat || 'daily',
      enabled: taskData.enabled ?? true,
      lastRunAt: taskData.lastRunAt || null,
      nextRunAt: nextRun,
      conversationId: taskData.conversationId || null
    };

    const saved = await LocalDB.saveScheduledTask(taskToSave);
    await loadTasks();
    return saved;
  }, [loadTasks]);

  const deleteTask = useCallback(async (id) => {
    await LocalDB.deleteScheduledTask(id);
    await loadTasks();
  }, [loadTasks]);

  const toggleTask = useCallback(async (id, enabled) => {
    await LocalDB.toggleScheduledTask(id, enabled);
    await loadTasks();
  }, [loadTasks]);

  const executeTaskNow = useCallback(async (task) => {
    if (!task) return null;
    if (onCloseDrawerRef.current) {
      try {
        onCloseDrawerRef.current();
      } catch (_) {}
    }
    const res = await executeScheduledTask(task, {
      providerConfigs: providerConfigsRef.current,
      skills: skillsRef.current,
      onSimulateChat: onSimulateChatRef.current
    });
    await loadTasks();
    return res;
  }, [loadTasks]);

  // Periodic checker (runs every 15 seconds to reliably trigger due tasks on exact schedule)
  useEffect(() => {
    const checkAndExecuteDueTasks = async () => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const now = Date.now();
        const allTasks = await LocalDB.getScheduledTasks();
        let hasChanges = false;

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
              await executeScheduledTask(task, {
                providerConfigs: providerConfigsRef.current,
                skills: skillsRef.current,
                onSimulateChat: onSimulateChatRef.current
              });
              hasChanges = true;
            }
          }
        }

        if (hasChanges) {
          await loadTasks();
        }
      } catch (err) {
        console.warn('[useScheduledTasks] Check due tasks error:', err);
      } finally {
        isCheckingRef.current = false;
      }
    };

    const timer = setInterval(checkAndExecuteDueTasks, 15000);
    checkAndExecuteDueTasks();

    // Check immediately when app comes into foreground
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkAndExecuteDueTasks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadTasks]);

  return {
    tasks,
    isLoading,
    loadTasks,
    saveTask,
    deleteTask,
    toggleTask,
    executeTaskNow
  };
}
