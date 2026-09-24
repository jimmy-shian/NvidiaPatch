/**
 * Scheduled Tasks Engine & Preferences Bridge for AppWidget
 */
import { Preferences } from '@capacitor/preferences';
import { LocalDB } from '../storage/localDatabase';
import { NotificationService } from '../notifications/notificationService';
import { createProvider } from '../providers';
import { AgentCore } from '../agent/agentCore';

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
    const payload = JSON.stringify({
      title: title || '今日排程任務',
      summary: (summary || '').slice(0, 200),
      updatedAt: Date.now(),
      conversationId: conversationId || null,
      taskId: taskId || null
    });

    await Preferences.set({
      key: 'widget_latest_task',
      value: payload
    });
  } catch (err) {
    console.warn('[ScheduleEngine] Write widget latest task failed:', err);
  }
}

/**
 * Executes a single scheduled task
 */
export async function executeScheduledTask(task, { providerConfigs, skills = [] }) {
  if (!task || !task.enabled) return null;

  const startedAt = Date.now();
  let conversationId = task.conversationId;

  // 1. Create or get conversation
  if (!conversationId) {
    conversationId = `conv_task_${Date.now()}`;
    await LocalDB.saveConversation({
      id: conversationId,
      title: task.name || '排程任務',
      skillIds: task.skillIds || ['daily-fortune'],
      createdAt: startedAt,
      updatedAt: startedAt
    });
  }

  const userMsgId = `msg_user_${Date.now()}`;
  const assistantMsgId = `msg_asst_${Date.now() + 1}`;

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

    const stream = await provider.sendMessageStream({
      model: task.modelId,
      messages,
      systemInstruction: systemPrompt
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        finalContent += chunk.text;
      }
    }
  } catch (err) {
    isFailed = true;
    finalContent = `[排程執行錯誤]: ${err.message}`;
    console.error('[ScheduleEngine] Task execution error:', err);
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

  // 4. Update Task Next Run Time
  const nextRunAt = task.repeat === 'once'
    ? null
    : calculateNextRunTime(task.time, task.repeat, new Date(completedAt));

  const updatedTask = {
    ...task,
    conversationId,
    lastRunAt: completedAt,
    nextRunAt,
    enabled: task.repeat === 'once' ? false : task.enabled
  };
  await LocalDB.saveScheduledTask(updatedTask);

  // 5. Send Notification
  await NotificationService.sendCompletionNotification({
    conversationId,
    title: task.name || '排程任務已完成',
    body: finalContent,
    isError: isFailed
  });

  // 6. Write to Widget Preferences
  await writeWidgetLatestTask({
    title: task.name || '排程任務',
    summary: finalContent,
    conversationId,
    taskId: task.id
  });

  return updatedTask;
}
