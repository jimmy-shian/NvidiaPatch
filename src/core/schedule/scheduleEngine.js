/**
 * Scheduled Tasks Engine & Preferences Bridge for AppWidget
 */
import { Preferences } from '@capacitor/preferences';
import { LocalDB } from '../storage/localDatabase';
import { NotificationService } from '../notifications/notificationService';
import { createProvider } from '../providers';
import { AgentCore } from '../agent/agentCore';
import { NativeStreamClient } from '../network/nativeStreamClient';

const runningTaskIds = new Set();

/**
 * Checks if a task is currently executing
 */
export function isTaskExecuting(taskId) {
  return runningTaskIds.has(taskId);
}

/**
 * Calculates the next timestamp for a given time "HH:mm" and repeat rule
 * @param {string} timeStr - "HH:mm" e.g. "07:30"
 * @param {string} repeat - 'daily' | 'once' | 'weekly:1,3,5'
 * @param {Date} [fromTime=new Date()]
 * @returns {number} Timestamp in ms
 */
export function calculateNextRunTime(timeStr, repeat = 'daily', fromTime = new Date()) {
  const [hourStr, minuteStr] = (timeStr || '08:00').split(':');
  const targetHour = parseInt(hourStr, 10) || 0;
  const targetMinute = parseInt(minuteStr, 10) || 0;

  const candidate = new Date(fromTime.getTime());
  candidate.setHours(targetHour, targetMinute, 0, 0);

  // If time has already passed today, advance day
  if (candidate.getTime() <= fromTime.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  if (repeat === 'daily' || repeat === 'once') {
    return candidate.getTime();
  }

  if (repeat.startsWith('weekly:')) {
    // parse days, e.g. "weekly:1,3,5" (0=Sun, 1=Mon, ..., 6=Sat)
    const allowedDays = repeat.replace('weekly:', '').split(',').map(d => parseInt(d.trim(), 10));
    // Find next matching day of week
    for (let i = 0; i < 7; i++) {
      if (allowedDays.includes(candidate.getDay())) {
        return candidate.getTime();
      }
      candidate.setDate(candidate.getDate() + 1);
    }
  }

  return candidate.getTime();
}

/**
 * Write latest task result into Preferences for Android AppWidget consumption
 */
export async function writeWidgetLatestTask({ title, summary, conversationId, taskId }) {
  try {
    const cleanSummary = (summary || '')
      .replace(/^#+\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
      .slice(0, 300);

    const payload = JSON.stringify({
      title: title || '今日排程任務',
      summary: cleanSummary || '點擊開啟 NvidiaPatch 查看完整內容。',
      updatedAt: Date.now(),
      conversationId: conversationId || null,
      taskId: taskId || null
    });

    // 1. Capacitor Preferences
    await Preferences.set({
      key: 'widget_latest_task',
      value: payload
    });

    // 2. Direct Android Native AppWidget refresh via NativeStreamBridge
    if (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.updateWidget === 'function') {
      try {
        window.NativeStreamBridge.updateWidget(payload);
      } catch (bridgeErr) {
        console.warn('[ScheduleEngine] NativeStreamBridge.updateWidget failed:', bridgeErr);
      }
    }
  } catch (err) {
    console.warn('[ScheduleEngine] Write widget latest task failed:', err);
  }
}

/**
 * Advances a stale task that missed its run window by more than 4 hours
 */
export async function advanceStaleTask(task, now = Date.now()) {
  const nextRun = calculateNextRunTime(task.time, task.repeat, new Date(now));
  const updated = {
    ...task,
    nextRunAt: nextRun
  };
  await LocalDB.saveScheduledTask(updated);
  return updated;
}

/**
 * Executes a single scheduled task with concurrency locks and atomic nextRunAt advancement
 */
export async function executeScheduledTask(task, { providerConfigs, skills = [], onSimulateChat = null }) {
  if (!task || !task.enabled) return null;

  if (runningTaskIds.has(task.id)) {
    console.warn(`[ScheduleEngine] Task ${task.id} (${task.name}) is already executing, skipping duplicate trigger`);
    return null;
  }

  runningTaskIds.add(task.id);
  NativeStreamClient.startBackgroundExecution('scheduled_task_' + task.id);

  const startedAt = Date.now();
  let conversationId = task.conversationId;

  // ATOMIC ADVANCE: Update task nextRunAt in database IMMEDIATELY upon pickup
  // This guarantees that any concurrent check or remount will NEVER trigger this task again
  const nextRunAt = task.repeat === 'once'
    ? null
    : calculateNextRunTime(task.time, task.repeat, new Date(startedAt));

  let currentTaskRecord = {
    ...task,
    conversationId,
    lastRunAt: startedAt,
    nextRunAt,
    enabled: task.repeat === 'once' ? false : task.enabled
  };
  await LocalDB.saveScheduledTask(currentTaskRecord);

  // If chat engine delegate is provided, simulate user creating a new chat and streaming
  if (typeof onSimulateChat === 'function') {
    NativeStreamClient.startBackgroundExecution('task_' + task.id);
    try {
      const res = await onSimulateChat({
        title: task.name || '排程任務',
        prompt: task.prompt || '執行排程任務',
        skillIds: task.skillIds || ['daily-fortune'],
        providerId: task.providerId,
        modelId: task.modelId,
        shouldSwitchView: typeof document !== 'undefined' && !document.hidden
      });
      if (res?.conversationId) {
        currentTaskRecord.conversationId = res.conversationId;
        // Fetch generated assistant response to populate widget correctly!
        try {
          const msgs = await LocalDB.getMessages(res.conversationId);
          const lastAsstMsg = [...msgs].reverse().find(m => m.role === 'assistant');
          const summaryText = lastAsstMsg?.content || '排程任務已執行完成。';
          await writeWidgetLatestTask({
            title: task.name || '排程任務',
            summary: summaryText,
            conversationId: res.conversationId,
            taskId: task.id
          });
          currentTaskRecord.lastRunStatus = 'success';
        } catch (_) {}
        await LocalDB.saveScheduledTask(currentTaskRecord);
      }
      return currentTaskRecord;
    } finally {
      runningTaskIds.delete(task.id);
      NativeStreamClient.stopBackgroundExecution();
    }
  }

  // 1. Fallback Headless: Create or get conversation
  if (!conversationId) {
    conversationId = `conv_task_${startedAt}`;
    await LocalDB.saveConversation({
      id: conversationId,
      title: task.name || '排程任務',
      skillIds: task.skillIds || ['daily-fortune'],
      createdAt: startedAt,
      updatedAt: startedAt
    });
    currentTaskRecord.conversationId = conversationId;
    await LocalDB.saveScheduledTask(currentTaskRecord);
  }

  const userMsgId = `msg_user_${startedAt}`;
  const assistantMsgId = `msg_asst_${startedAt + 1}`;

  // Save User Prompt
  const userMsg = {
    id: userMsgId,
    conversationId,
    role: 'user',
    content: task.prompt || '執行排程任務',
    createdAt: startedAt
  };
  await LocalDB.saveMessage(userMsg);

  // 2. Resolve Provider & Execute AI
  const providerId = task.providerId || 'nvidia';
  const config = (providerConfigs && providerConfigs[providerId]) || {};
  let finalContent = '';
  let isFailed = false;

  NativeStreamClient.startBackgroundExecution('task_headless_' + task.id);
  try {
    const provider = createProvider(providerId, config);
    const activeSkills = (task.skillIds || []).map(id => skills.find(s => s.id === id)).filter(Boolean);

    let systemPrompt = '你是一個專業且守時的 AI 助手。現在正在執行使用者的定時排程任務，請根據使用者的需求給出詳實、精確且有幫助的分析。';
    if (activeSkills.length > 0) {
      systemPrompt += '\n\n' + activeSkills.map(s => `【技能: ${s.name || s.id}】\n${s.instructions || ''}`).join('\n\n');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task.prompt }
    ];

    const stream = provider.sendMessageStream
      ? provider.sendMessageStream({
          model: task.modelId,
          messages,
          systemInstruction: systemPrompt
        })
      : provider.chatStream({
          model: task.modelId,
          messages
        });

    let accumulatedReasoning = '';

    for await (const chunk of stream) {
      if (chunk.type === 'error') {
        isFailed = true;
        finalContent = `[排程執行錯誤]: ${chunk.text || chunk.delta || '串流傳輸錯誤'}`;
        break;
      }
      if (chunk.text) {
        finalContent += chunk.text;
      } else if (chunk.content) {
        finalContent += chunk.content;
      } else if (chunk.delta) {
        finalContent += chunk.delta;
      }
      if (chunk.reasoning) {
        accumulatedReasoning += chunk.reasoning;
      }
    }

    if (!finalContent.trim()) {
      if (accumulatedReasoning.trim()) {
        finalContent = accumulatedReasoning.trim();
      } else if (!isFailed) {
        isFailed = true;
        finalContent = '[排程執行結果為空或連線中斷]';
      }
    }
  } catch (err) {
    isFailed = true;
    finalContent = `[排程執行錯誤]: ${err.message}`;
    console.error('[ScheduleEngine] Task execution error:', err);
  } finally {
    runningTaskIds.delete(task.id);
    NativeStreamClient.stopBackgroundExecution();
  }

  // 3. Save Assistant Message
  const completedAt = Date.now();
  const assistantMsg = {
    id: assistantMsgId,
    conversationId,
    role: 'assistant',
    content: finalContent,
    createdAt: completedAt,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt
  };
  await LocalDB.saveMessage(assistantMsg);

  // 4. Send Notification
  await NotificationService.sendCompletionNotification({
    conversationId,
    title: task.name || '排程任務已完成',
    body: finalContent,
    isError: isFailed
  });

  // 5. Write to Widget Preferences
  await writeWidgetLatestTask({
    title: task.name || '排程任務',
    summary: finalContent,
    conversationId,
    taskId: task.id
  });

  currentTaskRecord = {
    ...currentTaskRecord,
    lastRunStatus: isFailed ? 'failed' : 'success',
    lastRunError: isFailed ? finalContent : null
  };
  await LocalDB.saveScheduledTask(currentTaskRecord);

  return currentTaskRecord;
}
