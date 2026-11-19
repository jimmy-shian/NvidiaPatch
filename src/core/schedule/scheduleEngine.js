/**
 * Scheduled Tasks Engine & Preferences Bridge for AppWidget / Native AlarmManager
 */
import { Preferences } from '@capacitor/preferences';
import { LocalDB } from '../storage/localDatabase';
import { NotificationService } from '../notifications/notificationService';
import { createProvider, PROVIDER_TYPES } from '../providers';
import { DEFAULT_NVIDIA_MODEL } from '../providers/NvidiaNimProvider';
import { NativeStreamClient } from '../network/nativeStreamClient';
import { SecureStorage } from '../security/secureStorage';
import { getTemporalSystemContext } from '../agent/promptBuilder';
import { SkillManager } from '../skills/skillManager';

const runningTaskIds = new Set();
let inMemorySelectedWidgetTaskId = null;

export const MAX_RUN_HISTORY_PER_TASK = 30;
export const WIDGET_SUMMARY_MAX_CJK_CHARS = 30;
export const WIDGET_SUMMARY_MAX_ASCII_CHARS = 60;

export const SCHEDULE_SUMMARY_DIRECTIVE = `=== 🔴 桌面小工具摘要規範 (WIDGET SUMMARY DIRECTIVE) ===
這是系統定時排程任務。請先產出完整詳實的 Markdown 回覆，接著務必在整則回覆的最末端，另附一組精簡桌面摘要標籤：
<widget-summary>10～30個中文字內的核心結論摘要</widget-summary>
規範：
1. 摘要必須真實反映本次任務的實際執行結果與重要結論、關鍵資訊或任務狀態，禁止截取空泛前言。
2. 禁止寒暄文字（例如「好的」、「以下為您分析」），直接給出結論重點，控制在 10～30 個中文字內。
3. 不可將 <widget-summary> 包裹在程式碼區塊內，必須置於完整回覆最末端。
4. 排程任務為自動執行報告，無需輸出 <options> 互動按鈕。`;

/**
 * Checks if a task is currently executing
 */
export function isTaskExecuting(taskId) {
  return runningTaskIds.has(taskId);
}

/**
 * Identifies whether a conversation belongs to scheduled tasks rather than general user chat.
 */
export function isScheduleConversation(conv) {
  if (!conv || typeof conv !== 'object') return false;
  if (conv.type === 'schedule') return true;
  if (conv.scheduleId || conv.taskId) return true;
  if (typeof conv.id === 'string' && (conv.id.startsWith('conv_task_') || conv.id.startsWith('conv_native_'))) {
    return true;
  }
  return false;
}

/**
 * Formats a schedule run title with date and time so historical records are clearly distinguishable.
 */
export function formatScheduleRunTitle(taskName, timestamp = Date.now()) {
  const baseName = (typeof taskName === 'string' && taskName.trim()) ? taskName.trim() : '排程任務';
  const d = new Date(timestamp || Date.now());
  if (Number.isNaN(d.getTime())) return baseName;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const dateSuffix = `${year}-${month}-${day} ${hour}:${min}`;
  if (baseName.includes(dateSuffix)) return baseName;
  return `${baseName} (${dateSuffix})`;
}

/**
 * Cleans markdown, reasoning <think> blocks, <options> blocks, <widget-summary>, and meihua tags for display
 */
export function cleanTaskSummary(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  const stripFormatting = (str) => str
    .replace(/<widget-summary\b[^>]*>[\s\S]*?(?:<\/widget-summary>|$)/gi, '')
    .replace(/<options[\s\S]*?<\/options>/gi, '')
    .replace(/<options[\s\S]*/gi, '')
    .replace(/<option\b[^>]*?(?:\/>|>[\s\S]*?<\/option>)/gi, '')
    .replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>/gi, '')
    .replace(/<meihua-numbers[^>]*\/>/gi, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  const withoutThink = stripFormatting(
    rawText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*/gi, '')
  );
  if (withoutThink) return withoutThink;

  return stripFormatting(rawText.replace(/<\/?think>/gi, ''));
}

function clampWidgetSummary(rawSummary, maxCjk = WIDGET_SUMMARY_MAX_CJK_CHARS) {
  const normalized = String(rawSummary || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const hasCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(normalized);
  const limit = hasCjk ? maxCjk : WIDGET_SUMMARY_MAX_ASCII_CHARS;
  if (normalized.length <= limit) return normalized;

  const slice = normalized.slice(0, limit);
  const minCut = Math.floor(limit * 0.55);
  for (let i = slice.length - 1; i >= minCut; i--) {
    const ch = slice[i];
    if ('。！？!?'.includes(ch)) {
      return slice.slice(0, i + 1).trim();
    }
    if ('，,；;、 '.includes(ch)) {
      const head = slice.slice(0, i).replace(/[，,；;、:\s]+$/, '').trim();
      if (head.length >= 4) {
        return head.length + 1 <= limit ? `${head}…` : head;
      }
    }
  }
  return `${normalized.slice(0, Math.max(1, limit - 1)).trim()}…`;
}

/**
 * Fallback summary generator when the LLM did not emit <widget-summary>.
 * Skips boilerplate greetings and prioritizes conclusion/status/recommendation sentences.
 */
export function buildFallbackWidgetSummary(rawText, maxCjkChars = WIDGET_SUMMARY_MAX_CJK_CHARS) {
  const cleaned = cleanTaskSummary(rawText);
  if (!cleaned) return '';

  const rawLines = cleaned
    .split(/\r?\n/)
    .map(l => l.trim().replace(/^[-*•●▪▸]+\s*/, '').replace(/^\d+[.)、]\s*/, '').trim())
    .filter(l => l && !/^[-*_=#~]{2,}$/.test(l));

  const greetingOnlyRe = /^(?:好的|沒問題|收到|了解|當然|您好|哈囉|嗨|以下(?:是|為您)?(?:整理|分析|說明|報告|建議)?|為您(?:分析|整理|說明|提供)(?:如下)?)[！!。，,：:\s]*$/i;
  const leadingGreetingRe = /^(?:好的|沒問題|收到|了解|您好|哈囉|嗨)[，,！!。\s]+/;
  const introLeadRe = /^(?:以下(?:是|為您)?(?:整理|分析|說明|報告|摘要)?|為您(?:分析|整理|提供)如下)[：:，,\s]*/;

  const mergedLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i]
      .replace(leadingGreetingRe, '')
      .replace(introLeadRe, '')
      .trim();
    if (!line || greetingOnlyRe.test(line)) continue;
    // Skip pure intro headers like "詳細分析如下：" when other lines exist
    if (/(?:如下|分析如下)[：:]\s*$/.test(line) && rawLines.length > 1) continue;

    // Pair short heading label with following substantive sentence if compact
    if (
      line.length <= 8 &&
      !/[。！？!?：:]$/.test(line) &&
      i + 1 < rawLines.length
    ) {
      const nextLine = rawLines[i + 1]
        .replace(leadingGreetingRe, '')
        .replace(introLeadRe, '')
        .trim();
      if (nextLine && !greetingOnlyRe.test(nextLine)) {
        mergedLines.push(`${line}：${nextLine}`);
        i++;
        continue;
      }
    }
    mergedLines.push(line);
  }

  const candidateSource = mergedLines.length > 0 ? mergedLines.join('\n') : cleaned;
  const sentences = candidateSource
    .split(/(?<=[。！？!?])\s*|\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return clampWidgetSummary(cleaned, maxCjkChars);
  }

  const strongConclusionRe = /(結論|總結|總評|綜合|核心|summary|conclusion)/i;
  const domainConclusionRe = /(建議|重點|結果|狀態|提醒|注意|吉凶|大吉|中吉|小吉|平|凶|宜|忌|趨勢|風險|完成|成功|失敗)/i;
  const labelPrefixRe = /^(?:結論|總結|總評|綜合建議|綜合評斷|綜合評估|重點摘要|核心結論|執行結果)[：:\s]+/;

  let bestSentence = null;
  let bestScore = -1;

  sentences.forEach((s, idx) => {
    if (/(?:如下|說明如下)[：:]\s*$/.test(s) && sentences.length > 1) return;
    let score = 0;
    if (strongConclusionRe.test(s)) score += 100;
    if (domainConclusionRe.test(s)) score += 40;
    // Slight preference for later sentences when strong conclusion markers exist, or first substantive sentence
    if (idx === sentences.length - 1 && sentences.length > 1) score += 5;
    if (s.length >= 6 && s.length <= 45) score += 10;
    if (s.length < 4) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      bestSentence = s;
    }
  });

  const chosen = (bestSentence || sentences[0]).replace(labelPrefixRe, '').trim() || sentences[0];
  return clampWidgetSummary(chosen, maxCjkChars);
}

/**
 * Separates full response text and concise home-screen widget summary from an LLM schedule reply.
 */
export function extractScheduleResultAndSummary(rawText, { isFailed = false, explicitSummary = null } = {}) {
  const source = typeof rawText === 'string' ? rawText : '';
  const unwrapped = source.replace(
    /```(?:xml|html)?\s*\r?\n?\s*(<widget-summary\b[\s\S]*?<\/widget-summary>)\s*\r?\n?\s*```/gi,
    '$1'
  );

  const closedMatch = unwrapped.match(/<widget-summary\b[^>]*>([\s\S]*?)<\/widget-summary>/i);
  const openMatch = !closedMatch ? unwrapped.match(/<widget-summary\b[^>]*>([\s\S]*)$/i) : null;
  const tagSummary = closedMatch?.[1] ?? openMatch?.[1] ?? '';

  const fullContent = unwrapped
    .replace(/<widget-summary\b[^>]*>[\s\S]*?(?:<\/widget-summary>|$)/gi, '')
    .trim();

  if (isFailed) {
    const errClean = cleanTaskSummary(fullContent || unwrapped)
      .replace(/^\[(?:排程執行)?錯誤\][:：]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const failSummary = clampWidgetSummary(errClean ? `⚠️ 失敗：${errClean}` : '⚠️ 排程執行失敗');
    return {
      fullContent: fullContent || '[排程執行錯誤]: 無法取得 AI 回應',
      summary: failSummary || '⚠️ 排程執行失敗',
      hasExplicitSummary: false
    };
  }

  const candidateExplicit = explicitSummary || tagSummary;
  const cleanedExplicit = cleanTaskSummary(candidateExplicit).replace(/\s+/g, ' ').trim();
  if (cleanedExplicit) {
    return {
      fullContent,
      summary: clampWidgetSummary(cleanedExplicit),
      hasExplicitSummary: true
    };
  }

  const fallbackSummary = buildFallbackWidgetSummary(fullContent || unwrapped) || '排程任務已完成';
  return {
    fullContent,
    summary: fallbackSummary,
    hasExplicitSummary: false
  };
}

/**
 * Builds optional prior-run context ONLY when the task explicitly opts into history context.
 */
export function buildScheduleHistoryContext(task) {
  if (!task || !task.includeHistoryContext) return '';
  const history = Array.isArray(task.runHistory) ? task.runHistory : [];
  const successfulRuns = history
    .filter(r => r && r.status !== 'failed' && (r.summary || r.fullContent))
    .slice(0, 3);

  if (successfulRuns.length > 0) {
    const lines = successfulRuns.map(r => {
      const dateStr = formatScheduleRunTitle('', r.executedAt).replace(/^\S+\s*\(/, '').replace(/\)$/, '');
      const excerpt = cleanTaskSummary(r.summary || r.fullContent).slice(0, 120);
      return `- [${dateStr}] ${excerpt}`;
    });
    return `=== 近期排程歷史參考 (OPT-IN PREVIOUS RUNS) ===\n${lines.join('\n')}`;
  }

  if (task.lastRunStatus !== 'failed' && task.lastRunSummary && task.lastRunSummary !== '排程任務已執行完成。') {
    return `=== 前次排程結果參考 ===\n${cleanTaskSummary(task.lastRunSummary).slice(0, 200)}`;
  }

  return '';
}

async function safePrefGet(key) {
  try {
    if (typeof Preferences?.get === 'function') {
      const res = await Preferences.get({ key });
      return res?.value ?? null;
    }
  } catch (_) {}
  return null;
}

async function safePrefSet(key, value) {
  try {
    if (typeof Preferences?.set === 'function') {
      await Preferences.set({ key, value: value == null ? '' : String(value) });
    }
  } catch (_) {}
}

/**
 * Reads the currently selected task ID for the home screen widget
 */
export async function getSelectedWidgetTaskId() {
  const stored = await safePrefGet('widget_selected_task_id');
  if (stored && stored !== 'null' && stored !== 'undefined') {
    inMemorySelectedWidgetTaskId = stored;
    return stored;
  }
  return inMemorySelectedWidgetTaskId;
}

/**
 * Persists the selected task ID for the home screen widget
 */
export async function setSelectedWidgetTaskId(taskId) {
  const normalized = taskId && taskId !== 'null' && taskId !== 'undefined' ? String(taskId) : null;
  inMemorySelectedWidgetTaskId = normalized;
  await safePrefSet('widget_selected_task_id', normalized || '');
  return normalized;
}

/**
 * Resolves provider config with defensive fallback to SecureStorage & LocalDB
 */
async function resolveProviderConfig(providerId, providerConfigs) {
  const pid = providerId || 'nvidia';
  const passedCfg = (providerConfigs && providerConfigs[pid]) || {};
  const providerMeta = PROVIDER_TYPES.find(p => p.id === pid);
  let baseUrl = passedCfg.baseUrl || '';
  let apiKey = passedCfg.apiKey || '';
  let defaultModel = passedCfg.defaultModel || '';

  if (!apiKey || !baseUrl) {
    try {
      if (!apiKey) {
        apiKey = (await SecureStorage.getItem(`api_key_${pid}`)) || '';
      }
      if (!baseUrl || !defaultModel) {
        const dbConfigs = await LocalDB.getProviderConfigs();
        const dbCfg = dbConfigs.find(c => c.id === pid);
        if (dbCfg) {
          if (!baseUrl && dbCfg.baseUrl) baseUrl = dbCfg.baseUrl;
          if (!defaultModel && dbCfg.defaultModel) defaultModel = dbCfg.defaultModel;
        }
      }
    } catch (_) {}
  }

  return {
    ...passedCfg,
    id: pid,
    baseUrl: baseUrl || providerMeta?.defaultEndpoint || 'https://integrate.api.nvidia.com/v1',
    apiKey,
    defaultModel: defaultModel || (pid === 'nvidia' ? DEFAULT_NVIDIA_MODEL : '')
  };
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
export async function writeWidgetLatestTask({
  title,
  summary,
  conversationId,
  taskId,
  scheduleId = null,
  runId = null,
  executedAt = null,
  time = null,
  lastRunStatus = null,
  updatedAt = null
}) {
  try {
    const cleanSummary = cleanTaskSummary(summary).slice(0, 300);
    const resolvedScheduleId = scheduleId || taskId || null;

    const payloadObj = {
      title: title || '今日排程任務',
      summary: cleanSummary || '點擊開啟 NvidiaPatch 查看完整內容。',
      updatedAt: updatedAt || Date.now(),
      conversationId: conversationId || null,
      taskId: resolvedScheduleId,
      scheduleId: resolvedScheduleId,
      runId: runId || null,
      executedAt: executedAt || null
    };
    if (time) payloadObj.time = time;
    if (lastRunStatus) payloadObj.lastRunStatus = lastRunStatus;

    const payload = JSON.stringify(payloadObj);

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
 * Builds task payload for Android native AlarmManager & StreamForegroundService
 */
async function buildNativeScheduledTasksPayload(allTasks, providerConfigs, skills = []) {
  const nativeList = [];
  for (const t of allTasks) {
    const providerId = t.providerId || 'nvidia';
    const cfg = await resolveProviderConfig(providerId, providerConfigs);
    const skillIds = Array.isArray(t.skillIds) && t.skillIds.length > 0 ? t.skillIds : ['daily-fortune'];
    let systemPrompt = '你是一個專業且守時的 AI 助手。現在正在執行使用者的定時排程任務，請根據使用者的需求給出詳實、精確且有幫助的分析。';
    try {
      const skillBlock = await SkillManager.buildSkillSystemMessage(skillIds);
      if (skillBlock) {
        systemPrompt += '\n\n' + skillBlock;
      } else if (skills && skills.length > 0) {
        const matched = skillIds.map(id => skills.find(s => s.id === id)).filter(Boolean);
        if (matched.length > 0) {
          systemPrompt += '\n\n' + matched.map(s => `【技能: ${s.name || s.id}】\n${s.instructions || ''}`).join('\n\n');
        }
      }
    } catch (_) {}

    const historyBlock = buildScheduleHistoryContext(t);
    if (historyBlock) {
      systemPrompt += '\n\n' + historyBlock;
    }
    systemPrompt += '\n\n' + SCHEDULE_SUMMARY_DIRECTIVE;

    nativeList.push({
      id: t.id,
      scheduleId: t.id,
      name: t.name || '排程任務',
      prompt: t.prompt || '',
      time: t.time || '08:00',
      repeat: t.repeat || 'daily',
      enabled: Boolean(t.enabled),
      includeHistoryContext: Boolean(t.includeHistoryContext),
      nextRunAt: t.nextRunAt || null,
      conversationId: t.conversationId || null,
      skillIds,
      providerId,
      modelId: t.modelId || cfg.defaultModel || DEFAULT_NVIDIA_MODEL,
      baseUrl: cfg.baseUrl || 'https://integrate.api.nvidia.com/v1',
      apiKey: cfg.apiKey || '',
      systemPrompt
    });
  }
  return nativeList;
}

/**
 * Syncs all scheduled tasks with Android Home Screen Widget and native AlarmManager
 */
export async function syncWidgetAndNativeSchedules({
  tasks = null,
  selectedTaskId = undefined,
  providerConfigs = null,
  skills = []
} = {}) {
  try {
    const imported = await syncPendingNativeTaskResults();
    const allTasks = (Array.isArray(tasks) && !imported) ? tasks : await LocalDB.getScheduledTasks();
    const resolvedSelectedId = selectedTaskId !== undefined ? selectedTaskId : await getSelectedWidgetTaskId();

    const widgetTasks = [];
    for (const t of allTasks) {
      const latest = t.latestResult || null;
      const effectiveStatus = isTaskExecuting(t.id)
        ? 'running'
        : (latest?.status || t.lastRunStatus || null);

      let summary = '';
      if (effectiveStatus === 'running') {
        summary = '⏳ 正在背景執行排程分析中…';
      } else if (effectiveStatus === 'failed') {
        const errCandidate = cleanTaskSummary(latest?.summary || t.lastRunSummary || t.lastRunError || '')
          .replace(/^\[(?:排程執行)?錯誤\][:：]?\s*/i, '')
          .trim();
        summary = errCandidate.startsWith('⚠️')
          ? errCandidate
          : `⚠️ 失敗：${errCandidate || '執行發生錯誤'}`;
      } else {
        const explicitSummary = latest?.summary || t.lastRunSummary;
        if (explicitSummary && explicitSummary !== '排程任務已執行完成。') {
          summary = cleanTaskSummary(explicitSummary);
        } else if (latest?.fullContent || t.lastRunFullContent) {
          summary = extractScheduleResultAndSummary(latest?.fullContent || t.lastRunFullContent).summary;
        } else if (t.conversationId) {
          // Legacy migration fallback when task predates latestResult/lastRunSummary
          try {
            const msgs = await LocalDB.getMessages(t.conversationId);
            const lastAsstMsg = [...msgs].reverse().find(m => m.role === 'assistant');
            const rawCandidate = lastAsstMsg?.content || lastAsstMsg?.thinkingContent || '';
            if (rawCandidate) {
              summary = extractScheduleResultAndSummary(rawCandidate).summary;
            }
          } catch (_) {}
        }
      }

      if (!summary) {
        summary = t.prompt ? `待執行：${t.prompt.slice(0, 30)}` : '點擊開啟 NvidiaPatch 設定排程';
      }

      widgetTasks.push({
        scheduleId: t.id,
        taskId: t.id,
        runId: latest?.runId || t.latestRunId || null,
        title: t.name || '排程任務',
        summary: summary.slice(0, 300),
        time: t.time || '08:00',
        repeat: t.repeat || 'daily',
        enabled: Boolean(t.enabled),
        nextRunAt: t.nextRunAt || null,
        executedAt: latest?.executedAt || t.lastRunAt || null,
        lastRunAt: latest?.executedAt || t.lastRunAt || null,
        lastRunStatus: effectiveStatus,
        updatedAt: latest?.completedAt || t.lastCompletedAt || t.lastRunAt || t.updatedAt || Date.now(),
        conversationId: latest?.conversationId || t.conversationId || null
      });
    }

    const activeTask = widgetTasks.length > 0
      ? (widgetTasks.find(w => w.taskId === resolvedSelectedId) ||
         widgetTasks.find(w => w.enabled) ||
         widgetTasks[0])
      : null;

    const effectiveSelectedId = activeTask ? activeTask.taskId : null;
    inMemorySelectedWidgetTaskId = effectiveSelectedId;

    await safePrefSet('widget_tasks_list', JSON.stringify(widgetTasks));
    await safePrefSet('widget_selected_task_id', effectiveSelectedId || '');

    if (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.syncScheduledTasks === 'function') {
      try {
        const nativePayload = await buildNativeScheduledTasksPayload(allTasks, providerConfigs, skills);
        window.NativeStreamBridge.syncScheduledTasks(JSON.stringify(nativePayload));
      } catch (syncErr) {
        console.warn('[ScheduleEngine] syncScheduledTasks failed:', syncErr);
      }
    }

    // Write widget_latest_task last so Preferences listeners and tests observe the final active widget state
    if (activeTask) {
      await writeWidgetLatestTask({
        title: activeTask.title,
        summary: activeTask.summary,
        conversationId: activeTask.conversationId,
        taskId: activeTask.taskId,
        scheduleId: activeTask.scheduleId,
        runId: activeTask.runId,
        executedAt: activeTask.executedAt,
        time: activeTask.time,
        lastRunStatus: activeTask.lastRunStatus,
        updatedAt: activeTask.updatedAt
      });
    } else {
      await writeWidgetLatestTask({
        title: '每日排程運勢',
        summary: '尚未設定排程任務，點擊開啟 NvidiaPatch 新增排程。',
        conversationId: null,
        taskId: null,
        scheduleId: null,
        runId: null,
        executedAt: null
      });
    }

    return { widgetTasks, selectedTaskId: effectiveSelectedId };
  } catch (err) {
    console.warn('[ScheduleEngine] syncWidgetAndNativeSchedules failed:', err);
    return { widgetTasks: [], selectedTaskId: null };
  }
}

/**
 * Merges a completed run record into a scheduled task's runHistory and promotes it
 * to latestResult ONLY if its executedAt is >= the existing latest executedAt.
 * Prevents out-of-order async completions from overwriting newer results.
 */
async function commitScheduleRunResult(task, runData, { extraTaskFields = {} } = {}) {
  const scheduleId = task.id;
  const latestFromDb = scheduleId ? await LocalDB.getScheduledTask(scheduleId) : null;
  const baseTask = latestFromDb || task;

  const runRecord = {
    scheduleId,
    runId: runData.runId,
    conversationId: runData.conversationId || null,
    title: runData.title || formatScheduleRunTitle(baseTask.name, runData.executedAt),
    executedAt: runData.executedAt,
    completedAt: runData.completedAt || runData.executedAt,
    status: runData.status,
    summary: runData.summary,
    fullContent: runData.fullContent,
    error: runData.error || null
  };

  const existingHistory = Array.isArray(baseTask.runHistory) ? baseTask.runHistory : [];
  const mergedHistory = [
    runRecord,
    ...existingHistory.filter(r => r && r.runId !== runRecord.runId && (!runRecord.conversationId || r.conversationId !== runRecord.conversationId))
  ]
    .sort((a, b) => {
      if ((b.executedAt || 0) !== (a.executedAt || 0)) {
        return (b.executedAt || 0) - (a.executedAt || 0);
      }
      return (b.completedAt || 0) - (a.completedAt || 0);
    })
    .slice(0, MAX_RUN_HISTORY_PER_TASK);

  const currentLatestExecutedAt = baseTask.latestResult?.executedAt ?? baseTask.lastRunAt ?? 0;
  const shouldPromoteLatest = runRecord.executedAt >= currentLatestExecutedAt;

  const updatedTask = {
    ...baseTask,
    ...extraTaskFields,
    scheduleId,
    runHistory: mergedHistory,
    ...(shouldPromoteLatest ? {
      conversationId: runRecord.conversationId || baseTask.conversationId || null,
      latestRunId: runRecord.runId,
      lastRunAt: runRecord.executedAt,
      lastCompletedAt: runRecord.completedAt,
      lastRunStatus: runRecord.status,
      lastRunSummary: runRecord.summary,
      lastRunFullContent: runRecord.fullContent,
      lastRunError: runRecord.status === 'failed' ? (runRecord.error || runRecord.summary) : null,
      latestResult: {
        scheduleId,
        runId: runRecord.runId,
        executedAt: runRecord.executedAt,
        completedAt: runRecord.completedAt,
        status: runRecord.status,
        summary: runRecord.summary,
        fullContent: runRecord.fullContent,
        conversationId: runRecord.conversationId
      }
    } : {})
  };

  await LocalDB.saveScheduledTask(updatedTask);
  return { updatedTask, runRecord, promotedLatest: shouldPromoteLatest };
}

/**
 * Imports any scheduled task results completed by Android native background service while app was closed
 */
export async function syncPendingNativeTaskResults() {
  if (typeof window === 'undefined' || !window.NativeStreamBridge || typeof window.NativeStreamBridge.consumePendingNativeTaskResults !== 'function') {
    return false;
  }

  try {
    const raw = window.NativeStreamBridge.consumePendingNativeTaskResults();
    if (!raw || !raw.trim() || raw.trim() === '[]') return false;

    const results = JSON.parse(raw);
    if (!Array.isArray(results) || results.length === 0) return false;

    let imported = false;
    for (const item of results) {
      if (!item || !item.conversationId) continue;

      const startedAt = item.executedAt || item.startedAt || Date.now();
      const completedAt = item.completedAt || startedAt;
      const scheduleId = item.scheduleId || item.taskId || null;
      const runId = item.runId || `run_${scheduleId || 'native'}_${startedAt}`;
      const skillIds = Array.isArray(item.skillIds) && item.skillIds.length > 0 ? item.skillIds : ['daily-fortune'];
      const isFailed = Boolean(item.isFailed);

      let resolvedContent = item.content || '';
      if (resolvedContent && /<think>/i.test(resolvedContent)) {
        const stripped = resolvedContent
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<think>[\s\S]*/gi, '')
          .trim();
        if (!stripped) {
          resolvedContent = resolvedContent.replace(/<\/?think>/gi, '').trim();
        }
      }

      const extracted = extractScheduleResultAndSummary(resolvedContent, {
        isFailed,
        explicitSummary: item.summary || null
      });

      const runTitle = formatScheduleRunTitle(item.taskName || '排程任務', startedAt);

      await LocalDB.saveConversation({
        id: item.conversationId,
        title: item.title || item.taskName || '排程任務',
        historyTitle: runTitle,
        taskName: item.taskName || '排程任務',
        skillIds,
        providerId: item.providerId || 'nvidia',
        modelId: item.modelId || DEFAULT_NVIDIA_MODEL,
        type: 'schedule',
        scheduleId,
        runId,
        executedAt: startedAt,
        completedAt,
        status: isFailed ? 'failed' : 'success',
        summary: extracted.summary,
        createdAt: startedAt,
        updatedAt: completedAt
      });

      const userMsgId = item.userMsgId || `msg_task_u_${startedAt}`;
      const assistantMsgId = item.assistantMsgId || `msg_task_a_${completedAt}`;

      await LocalDB.saveMessage({
        id: userMsgId,
        conversationId: item.conversationId,
        role: 'user',
        content: item.prompt || '執行排程任務',
        createdAt: startedAt,
        ordinal: 0
      });

      await LocalDB.saveMessage({
        id: assistantMsgId,
        conversationId: item.conversationId,
        role: 'assistant',
        modelName: (item.modelId || DEFAULT_NVIDIA_MODEL).split('/').pop(),
        content: extracted.fullContent,
        widgetSummary: extracted.summary,
        createdAt: completedAt,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        ordinal: 1
      });

      if (scheduleId) {
        const existingTask = await LocalDB.getScheduledTask(scheduleId);
        if (existingTask) {
          const nextRunAt = existingTask.repeat === 'once'
            ? null
            : (item.nextRunAt || calculateNextRunTime(existingTask.time, existingTask.repeat, new Date(completedAt)));
          await commitScheduleRunResult(existingTask, {
            runId,
            conversationId: item.conversationId,
            title: runTitle,
            executedAt: startedAt,
            completedAt,
            status: isFailed ? 'failed' : 'success',
            summary: extracted.summary,
            fullContent: extracted.fullContent,
            error: isFailed ? (item.content || extracted.summary) : null
          }, {
            nextRunAt,
            enabled: existingTask.repeat === 'once' ? false : existingTask.enabled
          });
        }
      }
      imported = true;
    }

    return imported;
  } catch (err) {
    console.warn('[ScheduleEngine] syncPendingNativeTaskResults failed:', err);
    return false;
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
export async function executeScheduledTask(task, {
  providerConfigs = null,
  skills = [],
  onSimulateChat = null,
  createProvider: customCreateProvider = null,
  force = false,
  startedAt: customStartedAt = null,
  runId: customRunId = null
} = {}) {
  if (!task || (!task.enabled && !force)) return null;

  if (runningTaskIds.has(task.id)) {
    console.warn(`[ScheduleEngine] Task ${task.id} (${task.name}) is already executing, skipping duplicate trigger`);
    return null;
  }

  runningTaskIds.add(task.id);
  NativeStreamClient.startBackgroundExecution(`正在背景執行排程：${task.name || '排程任務'}`);

  const startedAt = typeof customStartedAt === 'number' ? customStartedAt : Date.now();
  const runId = customRunId || `run_${task.id}_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
  let conversationId = `conv_task_${task.id}_${startedAt}`;
  const runTitle = formatScheduleRunTitle(task.name || '排程任務', startedAt);

  // ATOMIC ADVANCE: Update task nextRunAt in database IMMEDIATELY upon pickup
  // Preserve newer lastRunAt if another run already ran later
  const existingLatest = await LocalDB.getScheduledTask(task.id);
  const baseTaskForStart = existingLatest || task;
  const prevLastRunAt = baseTaskForStart.lastRunAt || 0;

  const nextRunAt = task.repeat === 'once'
    ? null
    : calculateNextRunTime(task.time, task.repeat, new Date(Math.max(startedAt, prevLastRunAt)));

  if (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.markTaskRunningInJs === 'function') {
    try {
      window.NativeStreamBridge.markTaskRunningInJs(task.id, nextRunAt || 0);
    } catch (_) {}
  }

  let currentTaskRecord = {
    ...baseTaskForStart,
    scheduleId: task.id,
    lastRunAt: Math.max(startedAt, prevLastRunAt),
    nextRunAt,
    enabled: task.repeat === 'once' ? false : task.enabled
  };
  await LocalDB.saveScheduledTask(currentTaskRecord);
  await syncWidgetAndNativeSchedules({ providerConfigs, skills });

  const historyContextBlock = buildScheduleHistoryContext(baseTaskForStart);
  const extraSystemPrompt = historyContextBlock
    ? `${historyContextBlock}\n\n${SCHEDULE_SUMMARY_DIRECTIVE}`
    : SCHEDULE_SUMMARY_DIRECTIVE;

  // If chat engine delegate is provided, execute isolated schedule run
  if (typeof onSimulateChat === 'function') {
    let isFailed = false;
    let finalSummary = '';
    try {
      const res = await onSimulateChat({
        taskId: task.id,
        runId,
        startedAt,
        existingConversationId: task.conversationId,
        title: task.name || '排程任務',
        runTitle,
        prompt: task.prompt || '執行排程任務',
        skillIds: task.skillIds || ['daily-fortune'],
        providerId: task.providerId,
        modelId: task.modelId,
        includeHistoryContext: Boolean(task.includeHistoryContext),
        extraSystemPrompt,
        shouldSwitchView: false
      });

      const resolvedConvId = res?.conversationId || conversationId;
      let rawResultText = res?.content || '';
      isFailed = Boolean(res?.isError);

      if (resolvedConvId) {
        conversationId = resolvedConvId;
        if (!rawResultText) {
          try {
            const msgs = await LocalDB.getMessages(resolvedConvId);
            const lastAsstMsg = [...msgs].reverse().find(m => m.role === 'assistant');
            rawResultText = lastAsstMsg?.content || lastAsstMsg?.thinkingContent || '';
          } catch (_) {}
        }
      }

      if (!rawResultText) {
        rawResultText = isFailed ? '[排程執行錯誤]: 無法取得 AI 回應' : '排程任務已執行完成。';
      } else if (/^\s*\[(?:排程執行)?錯誤\]|^\s*\n?\[錯誤\]:/m.test(rawResultText)) {
        isFailed = true;
      }

      const extracted = extractScheduleResultAndSummary(rawResultText, {
        isFailed,
        explicitSummary: res?.widgetSummary || null
      });
      finalSummary = extracted.summary;
      const completedAt = Date.now();

      // Ensure conversation metadata marks it as an isolated schedule run
      if (resolvedConvId) {
        const existingConv = await LocalDB.getConversation(resolvedConvId);
        await LocalDB.saveConversation({
          ...(existingConv || {}),
          id: resolvedConvId,
          title: existingConv?.title || runTitle,
          historyTitle: runTitle,
          taskName: task.name || '排程任務',
          type: 'schedule',
          scheduleId: task.id,
          runId,
          executedAt: startedAt,
          completedAt,
          status: isFailed ? 'failed' : 'success',
          summary: finalSummary,
          updatedAt: completedAt
        });
      }

      const committed = await commitScheduleRunResult(task, {
        runId,
        conversationId: resolvedConvId,
        title: runTitle,
        executedAt: startedAt,
        completedAt,
        status: isFailed ? 'failed' : 'success',
        summary: finalSummary,
        fullContent: extracted.fullContent,
        error: isFailed ? extracted.fullContent : null
      });
      currentTaskRecord = committed.updatedTask;

      await NotificationService.sendCompletionNotification({
        conversationId: resolvedConvId,
        taskId: task.id,
        title: isFailed
          ? `⚠️ 排程執行失敗：${task.name || '排程任務'}`
          : `✅ 排程完成：${task.name || '排程任務'}`,
        body: finalSummary || (isFailed ? '點擊查看錯誤詳情' : '排程任務已執行完成。'),
        isError: isFailed
      });
    } catch (err) {
      isFailed = true;
      const errFull = `[排程執行錯誤]: ${err?.message || '未知錯誤'}`;
      finalSummary = extractScheduleResultAndSummary(errFull, { isFailed: true }).summary;
      const completedAt = Date.now();

      const committed = await commitScheduleRunResult(task, {
        runId,
        conversationId: null,
        title: runTitle,
        executedAt: startedAt,
        completedAt,
        status: 'failed',
        summary: finalSummary,
        fullContent: errFull,
        error: errFull
      });
      currentTaskRecord = committed.updatedTask;

      await NotificationService.sendCompletionNotification({
        conversationId: currentTaskRecord.conversationId,
        taskId: task.id,
        title: `⚠️ 排程執行失敗：${task.name || '排程任務'}`,
        body: finalSummary,
        isError: true
      });
    } finally {
      runningTaskIds.delete(task.id);
      NativeStreamClient.stopBackgroundExecution();
    }

    await syncWidgetAndNativeSchedules({ providerConfigs, skills });
    return currentTaskRecord;
  }

  // 1. Fallback Headless: Always create an independent schedule conversation per run
  await LocalDB.saveConversation({
    id: conversationId,
    title: runTitle,
    historyTitle: runTitle,
    taskName: task.name || '排程任務',
    type: 'schedule',
    scheduleId: task.id,
    runId,
    executedAt: startedAt,
    skillIds: task.skillIds || ['daily-fortune'],
    createdAt: startedAt,
    updatedAt: startedAt
  });

  const userMsgId = `msg_user_${startedAt}`;
  const assistantMsgId = `msg_asst_${startedAt + 1}`;

  // Save User Prompt
  const userMsg = {
    id: userMsgId,
    conversationId,
    role: 'user',
    content: task.prompt || '執行排程任務',
    createdAt: startedAt,
    ordinal: 0
  };
  await LocalDB.saveMessage(userMsg);

  // 2. Resolve Provider & Execute AI (isolated from general chat history)
  const providerId = task.providerId || 'nvidia';
  const resolvedConfig = await resolveProviderConfig(providerId, providerConfigs);
  const resolvedModelId = task.modelId || resolvedConfig.defaultModel || DEFAULT_NVIDIA_MODEL;
  let rawFinalContent = '';
  let isFailed = false;

  try {
    const providerFactory = typeof customCreateProvider === 'function' ? customCreateProvider : createProvider;
    const provider = providerFactory(providerId, resolvedConfig);
    const activeSkills = (task.skillIds || []).map(id => skills.find(s => s.id === id)).filter(Boolean);

    let systemPrompt = '你是一個專業且守時的 AI 助手。現在正在執行使用者的定時排程任務，請根據使用者的需求給出詳實、精確且有幫助的分析。\n\n' + getTemporalSystemContext();
    try {
      const skillBlock = await SkillManager.buildSkillSystemMessage(task.skillIds || []);
      if (skillBlock) {
        systemPrompt += '\n\n' + skillBlock;
      } else if (activeSkills.length > 0) {
        systemPrompt += '\n\n' + activeSkills.map(s => `【技能: ${s.name || s.id}】\n${s.instructions || ''}`).join('\n\n');
      }
    } catch (_) {
      if (activeSkills.length > 0) {
        systemPrompt += '\n\n' + activeSkills.map(s => `【技能: ${s.name || s.id}】\n${s.instructions || ''}`).join('\n\n');
      }
    }

    systemPrompt += '\n\n' + extraSystemPrompt;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task.prompt }
    ];

    const stream = provider.sendMessageStream
      ? provider.sendMessageStream({
          model: resolvedModelId,
          messages,
          systemInstruction: systemPrompt
        })
      : provider.chatStream({
          model: resolvedModelId,
          messages
        });

    let accumulatedReasoning = '';

    for await (const chunk of stream) {
      if (chunk.type === 'error') {
        isFailed = true;
        rawFinalContent = `[排程執行錯誤]: ${chunk.text || chunk.delta || '串流傳輸錯誤'}`;
        break;
      }
      if (chunk.text) {
        rawFinalContent += chunk.text;
      } else if (chunk.content) {
        rawFinalContent += chunk.content;
      } else if (chunk.delta) {
        rawFinalContent += chunk.delta;
      }
      if (chunk.reasoning) {
        accumulatedReasoning += chunk.reasoning;
      }
    }

    if (!rawFinalContent.trim()) {
      if (accumulatedReasoning.trim()) {
        rawFinalContent = accumulatedReasoning.trim();
      } else if (!isFailed) {
        isFailed = true;
        rawFinalContent = '[排程執行結果為空或連線中斷]';
      }
    }
  } catch (err) {
    isFailed = true;
    rawFinalContent = `[排程執行錯誤]: ${err.message}`;
    console.error('[ScheduleEngine] Task execution error:', err);
  } finally {
    runningTaskIds.delete(task.id);
    NativeStreamClient.stopBackgroundExecution();
  }

  // 3. Separate full content & widget summary, save Assistant Message
  const completedAt = Date.now();
  const extracted = extractScheduleResultAndSummary(rawFinalContent, { isFailed });
  const assistantMsg = {
    id: assistantMsgId,
    conversationId,
    role: 'assistant',
    content: extracted.fullContent,
    widgetSummary: extracted.summary,
    createdAt: completedAt,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    ordinal: 1
  };
  await LocalDB.saveMessage(assistantMsg);

  await LocalDB.saveConversation({
    id: conversationId,
    title: runTitle,
    historyTitle: runTitle,
    taskName: task.name || '排程任務',
    type: 'schedule',
    scheduleId: task.id,
    runId,
    executedAt: startedAt,
    completedAt,
    status: isFailed ? 'failed' : 'success',
    summary: extracted.summary,
    updatedAt: completedAt
  });

  const committed = await commitScheduleRunResult(task, {
    runId,
    conversationId,
    title: runTitle,
    executedAt: startedAt,
    completedAt,
    status: isFailed ? 'failed' : 'success',
    summary: extracted.summary,
    fullContent: extracted.fullContent,
    error: isFailed ? extracted.fullContent : null
  });
  currentTaskRecord = committed.updatedTask;

  // 4. Send Notification
  await NotificationService.sendCompletionNotification({
    conversationId,
    taskId: task.id,
    title: isFailed
      ? `⚠️ 排程執行失敗：${task.name || '排程任務'}`
      : `✅ 排程完成：${task.name || '排程任務'}`,
    body: extracted.summary || extracted.fullContent,
    isError: isFailed
  });

  // 5. Sync Widget Preferences & Native Alarms
  await syncWidgetAndNativeSchedules({ providerConfigs, skills });

  return currentTaskRecord;
}
