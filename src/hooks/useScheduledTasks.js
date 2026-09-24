import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalDB } from '../core/storage/localDatabase';
import { calculateNextRunTime, executeScheduledTask } from '../core/schedule/scheduleEngine';

export function useScheduledTasks({ providerConfigs, skills = [] }) {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const isCheckingRef = useRef(false);

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

  // Periodic checker (runs every 30 seconds to trigger due tasks when App is active)
  useEffect(() => {
    const checkAndExecuteDueTasks = async () => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const now = Date.now();
        const allTasks = await LocalDB.getScheduledTasks();
        const dueTasks = allTasks.filter(t => t.enabled && t.nextRunAt && t.nextRunAt <= now);

        for (const task of dueTasks) {
          await executeScheduledTask(task, { providerConfigs, skills });
        }

        if (dueTasks.length > 0) {
          await loadTasks();
        }
      } catch (err) {
        console.warn('[useScheduledTasks] Check due tasks error:', err);
      } finally {
        isCheckingRef.current = false;
      }
    };

    const timer = setInterval(checkAndExecuteDueTasks, 30000);
    // Also check on mount
    checkAndExecuteDueTasks();

    return () => clearInterval(timer);
  }, [providerConfigs, skills, loadTasks]);

  return {
    tasks,
    isLoading,
    loadTasks,
    saveTask,
    deleteTask,
    toggleTask
  };
}
