import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateNextRunTime,
  writeWidgetLatestTask,
  cleanTaskSummary,
  setSelectedWidgetTaskId,
  syncWidgetAndNativeSchedules,
  syncPendingNativeTaskResults,
  extractScheduleResultAndSummary,
  isScheduleConversation,
  formatScheduleRunTitle,
  buildScheduleHistoryContext
} from '../scheduleEngine';
import { Preferences } from '@capacitor/preferences';
import { LocalDB } from '../../storage/localDatabase';
import { NotificationService } from '../../notifications/notificationService';
import { NativeStreamClient } from '../../network/nativeStreamClient';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ value: null })
  }
}));

describe('Schedule Engine & LocalDB Tasks Store', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clean in-memory scheduled tasks
    const existing = await LocalDB.getScheduledTasks();
    for (const t of existing) {
      await LocalDB.deleteScheduledTask(t.id);
    }
  });

  describe('Next Run Time Calculations', () => {
    it('schedules for today if target time has not passed yet', () => {
      const now = new Date(2024, 0, 1, 6, 0, 0); // 06:00
      const nextTs = calculateNextRunTime('08:00', 'daily', now);
      const nextDate = new Date(nextTs);

      expect(nextDate.getDate()).toBe(1);
      expect(nextDate.getHours()).toBe(8);
      expect(nextDate.getMinutes()).toBe(0);
    });

    it('schedules for tomorrow if target time has already passed today', () => {
      const now = new Date(2024, 0, 1, 9, 0, 0); // 09:00
      const nextTs = calculateNextRunTime('08:00', 'daily', now);
      const nextDate = new Date(nextTs);

      expect(nextDate.getDate()).toBe(2);
      expect(nextDate.getHours()).toBe(8);
      expect(nextDate.getMinutes()).toBe(0);
    });

    it('handles weekly rules correctly', () => {
      // 2024-01-01 is Monday (day 1)
      const now = new Date(2024, 0, 1, 10, 0, 0);
      // Next runs on Wednesday (day 3) or Friday (day 5)
      const nextTs = calculateNextRunTime('08:00', 'weekly:3,5', now);
      const nextDate = new Date(nextTs);

      expect(nextDate.getDay()).toBe(3); // Wednesday (2024-01-03)
      expect(nextDate.getDate()).toBe(3);
    });
  });

  describe('Widget Preferences Bridge', () => {
    it('writes latest task payload to Preferences', async () => {
      await writeWidgetLatestTask({
        title: '晨間運勢',
        summary: '今日大吉，百事順遂。',
        conversationId: 'conv_123',
        taskId: 'task_001'
      });

      expect(Preferences.set).toHaveBeenCalledTimes(1);
      const callArg = Preferences.set.mock.calls[0][0];
      expect(callArg.key).toBe('widget_latest_task');

      const parsed = JSON.parse(callArg.value);
      expect(parsed.title).toBe('晨間運勢');
      expect(parsed.summary).toContain('今日大吉');
      expect(parsed.conversationId).toBe('conv_123');
    });
  });

  describe('LocalDB Scheduled Tasks Store', () => {
    it('saves and retrieves scheduled tasks', async () => {
      const task = {
        id: 'task_test_1',
        name: '每日解卦',
        prompt: '問今日事業運',
        time: '07:30',
        repeat: 'daily',
        enabled: true,
        nextRunAt: Date.now() + 10000
      };

      await LocalDB.saveScheduledTask(task);

      const all = await LocalDB.getScheduledTasks();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('每日解卦');

      const single = await LocalDB.getScheduledTask('task_test_1');
      expect(single).not.toBeNull();
      expect(single.prompt).toBe('問今日事業運');
    });

    it('toggles task enabled status', async () => {
      const task = {
        id: 'task_toggle',
        name: '開關測試',
        enabled: true
      };
      await LocalDB.saveScheduledTask(task);

      await LocalDB.toggleScheduledTask('task_toggle', false);
      const updated = await LocalDB.getScheduledTask('task_toggle');
      expect(updated.enabled).toBe(false);
    });

    it('deletes scheduled tasks', async () => {
      await LocalDB.saveScheduledTask({ id: 'task_del', name: '刪除測試' });
      await LocalDB.deleteScheduledTask('task_del');

      const found = await LocalDB.getScheduledTask('task_del');
      expect(found).toBeFalsy();
    });

    it('advances stale tasks properly without late firing', async () => {
      const { advanceStaleTask } = await import('../scheduleEngine');
      const pastTime = Date.now() - (6 * 3600 * 1000); // 6 hours ago
      const staleTask = {
        id: 'task_stale',
        name: '過期任務',
        time: '08:00',
        repeat: 'daily',
        enabled: true,
        nextRunAt: pastTime
      };
      await LocalDB.saveScheduledTask(staleTask);

      const updated = await advanceStaleTask(staleTask);
      expect(updated.nextRunAt).toBeGreaterThan(Date.now());
      const inDb = await LocalDB.getScheduledTask('task_stale');
      expect(inDb.nextRunAt).toBe(updated.nextRunAt);
    });

    it('marks scheduled task as failed when stream yields error chunk', async () => {
      const { executeScheduledTask } = await import('../scheduleEngine');
      const testTask = {
        id: 'task_error_chunk',
        name: '錯誤串流測試',
        prompt: '測試排程報錯',
        providerId: 'mock_fail',
        modelId: 'mock_model',
        enabled: true,
        repeat: 'none'
      };

      const mockProvider = {
        chatStream() {
          return (async function* () {
            yield { type: 'chunk', text: '前置內容' };
            yield { type: 'error', text: '503 Service Unavailable' };
          })();
        }
      };

      const result = await executeScheduledTask(testTask, {
        createProvider: () => mockProvider
      });

      expect(result.lastRunStatus).toBe('failed');
      const messages = await LocalDB.getMessages(result.conversationId);
      const asstMsg = messages.find(m => m.role === 'assistant');
      expect(asstMsg.content).toContain('[排程執行錯誤]');
    });

    it('updates widget with conversationId and summary when executed via onSimulateChat', async () => {
      const { executeScheduledTask } = await import('../scheduleEngine');
      const testTask = {
        id: 'task_widget_sync',
        name: '每日排程運勢',
        prompt: '問今日排程分析',
        providerId: 'nvidia',
        modelId: 'meta/llama-3.3-70b-instruct',
        enabled: true,
        repeat: 'none'
      };

      const testConvId = 'conv_task_mock_123';
      await LocalDB.saveConversation({
        id: testConvId,
        title: '每日排程運勢',
        createdAt: Date.now()
      });
      await LocalDB.saveMessage({
        id: 'msg_asst_123',
        conversationId: testConvId,
        role: 'assistant',
        content: '今日運勢極佳，建議全力推進專案。',
        createdAt: Date.now()
      });

      const onSimulateChat = vi.fn().mockResolvedValue({
        conversationId: testConvId
      });

      const result = await executeScheduledTask(testTask, {
        onSimulateChat
      });

      expect(onSimulateChat).toHaveBeenCalledTimes(1);
      expect(result.conversationId).toBe(testConvId);
      expect(result.lastRunStatus).toBe('success');

      // Verify Preferences.set was called with widget_latest_task containing conversationId
      expect(Preferences.set).toHaveBeenCalled();
      const lastCall = Preferences.set.mock.calls[Preferences.set.mock.calls.length - 1][0];
      expect(lastCall.key).toBe('widget_latest_task');
      const parsed = JSON.parse(lastCall.value);
      expect(parsed.conversationId).toBe(testConvId);
      expect(parsed.summary).toContain('今日運勢極佳');
      expect(parsed.title).toBe('每日排程運勢');
    });

    it('sends completion notification and pairs start/stop background execution in onSimulateChat branch', async () => {
      const { executeScheduledTask } = await import('../scheduleEngine');
      const notifySpy = vi.spyOn(NotificationService, 'sendCompletionNotification').mockResolvedValue();
      const startBgSpy = vi.spyOn(NativeStreamClient, 'startBackgroundExecution');
      const stopBgSpy = vi.spyOn(NativeStreamClient, 'stopBackgroundExecution');

      const testTask = {
        id: 'task_notify_pair',
        name: '通知配對測試',
        prompt: '今日宜忌分析',
        providerId: 'nvidia',
        modelId: 'meta/llama-3.3-70b-instruct',
        enabled: true,
        repeat: 'daily'
      };

      const convId = 'conv_notify_pair_1';
      await LocalDB.saveConversation({ id: convId, title: '通知配對測試', createdAt: Date.now() });
      await LocalDB.saveMessage({
        id: 'msg_notify_1',
        conversationId: convId,
        role: 'assistant',
        content: '<think>內部思考</think>\n## 今日宜忌\n宜專注開發。\n<options title="延伸"><option label="看詳情" /></options>',
        createdAt: Date.now()
      });

      const onSimulateChat = vi.fn().mockResolvedValue({ conversationId: convId, isError: false });

      const result = await executeScheduledTask(testTask, { onSimulateChat });

      expect(result.lastRunStatus).toBe('success');
      expect(startBgSpy).toHaveBeenCalledTimes(1);
      expect(stopBgSpy).toHaveBeenCalledTimes(1);
      expect(notifySpy).toHaveBeenCalledTimes(1);
      expect(notifySpy.mock.calls[0][0]).toMatchObject({
        conversationId: convId,
        taskId: 'task_notify_pair',
        isError: false
      });
      expect(notifySpy.mock.calls[0][0].body).not.toContain('內部思考');
      expect(notifySpy.mock.calls[0][0].body).not.toContain('<options');

      notifySpy.mockRestore();
      startBgSpy.mockRestore();
      stopBgSpy.mockRestore();
    });

    it('marks task failed and sends error notification when onSimulateChat returns isError', async () => {
      const { executeScheduledTask } = await import('../scheduleEngine');
      const notifySpy = vi.spyOn(NotificationService, 'sendCompletionNotification').mockResolvedValue();

      const testTask = {
        id: 'task_notify_err',
        name: '錯誤通知測試',
        prompt: '錯誤測試',
        enabled: true,
        repeat: 'daily'
      };
      const convId = 'conv_err_1';
      await LocalDB.saveConversation({ id: convId, title: '錯誤通知測試', createdAt: Date.now() });
      await LocalDB.saveMessage({
        id: 'msg_err_1',
        conversationId: convId,
        role: 'assistant',
        content: '\n[錯誤]: API Key 無效',
        createdAt: Date.now()
      });

      const result = await executeScheduledTask(testTask, {
        onSimulateChat: vi.fn().mockResolvedValue({ conversationId: convId, isError: true })
      });

      expect(result.lastRunStatus).toBe('failed');
      expect(notifySpy).toHaveBeenCalledTimes(1);
      expect(notifySpy.mock.calls[0][0].isError).toBe(true);

      notifySpy.mockRestore();
    });
  });

  describe('cleanTaskSummary, Widget Task Selection & Native Sync', () => {
    it('strips <think>, <options>, meihua tags, and markdown symbols', () => {
      const raw = '<think>reasoning...</think>\n# 標題\n**重點內容** `<meihua-numbers n1="1" />`\n<options title="x"><option label="a" /></options>';
      const cleaned = cleanTaskSummary(raw);
      expect(cleaned).toBe('標題\n重點內容');
    });

    it('syncs multiple tasks list and selects pinned task for widget', async () => {
      await LocalDB.saveScheduledTask({
        id: 'task_a',
        name: '排程 A',
        prompt: '問 A',
        time: '07:00',
        repeat: 'daily',
        enabled: true,
        lastRunSummary: 'A 摘要結果',
        conversationId: 'conv_a',
        nextRunAt: Date.now() + 10000
      });
      await LocalDB.saveScheduledTask({
        id: 'task_b',
        name: '排程 B',
        prompt: '問 B',
        time: '20:00',
        repeat: 'daily',
        enabled: true,
        lastRunSummary: 'B 摘要結果',
        conversationId: 'conv_b',
        nextRunAt: Date.now() + 20000
      });

      await setSelectedWidgetTaskId('task_b');
      const res = await syncWidgetAndNativeSchedules({ selectedTaskId: 'task_b' });

      expect(res.selectedTaskId).toBe('task_b');
      expect(res.widgetTasks).toHaveLength(2);

      const calls = Preferences.set.mock.calls.map(c => c[0]);
      const listCall = calls.find(c => c.key === 'widget_tasks_list');
      const latestCall = calls[calls.length - 1];
      expect(listCall).toBeTruthy();
      expect(JSON.parse(listCall.value)).toHaveLength(2);
      expect(latestCall.key).toBe('widget_latest_task');
      expect(JSON.parse(latestCall.value)).toMatchObject({
        taskId: 'task_b',
        title: '排程 B',
        summary: 'B 摘要結果',
        conversationId: 'conv_b'
      });
    });

    it('imports pending native background task results into LocalDB', async () => {
      await LocalDB.saveScheduledTask({
        id: 'task_native_1',
        name: '原生背景排程',
        prompt: '背景執行題目',
        time: '08:00',
        repeat: 'daily',
        enabled: true,
        nextRunAt: Date.now() + 1000
      });

      const originalWindow = globalThis.window;
      globalThis.window = {
        NativeStreamBridge: {
          consumePendingNativeTaskResults: vi.fn().mockReturnValue(JSON.stringify([
            {
              taskId: 'task_native_1',
              taskName: '原生背景排程',
              prompt: '背景執行題目',
              conversationId: 'conv_native_999',
              content: '背景執行的完整 AI 分析結果',
              startedAt: 1700000000000,
              completedAt: 1700000005000,
              isFailed: false,
              nextRunAt: 1700086400000,
              repeat: 'daily'
            }
          ]))
        }
      };

      try {
        const imported = await syncPendingNativeTaskResults();
        expect(imported).toBe(true);

        const conv = await LocalDB.getConversation('conv_native_999');
        expect(conv).not.toBeNull();
        expect(conv.title).toBe('原生背景排程');

        const msgs = await LocalDB.getMessages('conv_native_999');
        expect(msgs).toHaveLength(2);
        expect(msgs[1].content).toBe('背景執行的完整 AI 分析結果');

        const updatedTask = await LocalDB.getScheduledTask('task_native_1');
        expect(updatedTask.conversationId).toBe('conv_native_999');
        expect(updatedTask.lastRunStatus).toBe('success');
        expect(updatedTask.lastRunSummary).toBe('背景執行的完整 AI 分析結果');
      } finally {
        globalThis.window = originalWindow;
      }
    });

    it('falls back to unclosed <think> content and thinkingContent instead of generic placeholder', async () => {
      const unclosedThink = '<think>今日甲木日主得祿，事業宜主動溝通與推進計畫。';
      expect(cleanTaskSummary(unclosedThink)).toBe('今日甲木日主得祿，事業宜主動溝通與推進計畫。');

      const convId = 'conv_think_only_widget';
      await LocalDB.saveConversation({ id: convId, title: '晨間每日運勢', createdAt: Date.now() });
      await LocalDB.saveMessage({
        id: 'msg_think_only_1',
        conversationId: convId,
        role: 'assistant',
        content: '',
        thinkingContent: '今日財運平穩，午後適合整理計畫並注意交通安全。',
        createdAt: Date.now()
      });
      await LocalDB.saveScheduledTask({
        id: 'task_think_only',
        name: '晨間每日運勢',
        prompt: '今日運勢',
        time: '07:30',
        repeat: 'daily',
        enabled: true,
        conversationId: convId,
        lastRunSummary: '排程任務已執行完成。',
        nextRunAt: Date.now() + 10000
      });

      const res = await syncWidgetAndNativeSchedules({ selectedTaskId: 'task_think_only' });
      const latestCall = Preferences.set.mock.calls.map(c => c[0]).reverse().find(c => c.key === 'widget_latest_task');
      expect(res.widgetTasks[0].summary).toContain('今日財運平穩');
      expect(JSON.parse(latestCall.value).summary).toContain('今日財運平穩');
    });
  });

  describe('Schedule Summary Extraction, Isolation & Out-of-order Protection', () => {
    it('extracts <widget-summary> separately from full reply and provides conclusion-based fallback', () => {
      const rawWithTag = `## 今日整體分析
早上適合處理溝通事項，下午避免衝動消費。

<widget-summary>今日偏吉，利溝通推進，忌衝動花費。</widget-summary>`;

      const extracted = extractScheduleResultAndSummary(rawWithTag);
      expect(extracted.hasExplicitSummary).toBe(true);
      expect(extracted.summary).toBe('今日偏吉，利溝通推進，忌衝動花費。');
      expect(extracted.fullContent).toContain('今日整體分析');
      expect(extracted.fullContent).not.toContain('<widget-summary>');

      const rawWithoutTag = `好的，以下為您整理今日天氣與出行建議。

詳細氣象說明請注意氣溫變化。

總結：午後短暫陣雨，出門記得帶傘。`;
      const fallback = extractScheduleResultAndSummary(rawWithoutTag);
      expect(fallback.hasExplicitSummary).toBe(false);
      expect(fallback.summary).toBe('午後短暫陣雨，出門記得帶傘。');
      expect(fallback.summary.length).toBeLessThanOrEqual(30);
    });

    it('separates schedule conversations from general chat and formats dated titles', () => {
      expect(isScheduleConversation({ id: 'conv_123', type: 'chat' })).toBe(false);
      expect(isScheduleConversation({ id: 'conv_meihua_1', type: 'meihua' })).toBe(false);
      expect(isScheduleConversation({ id: 'conv_abc', type: 'schedule' })).toBe(true);
      expect(isScheduleConversation({ id: 'conv_abc', scheduleId: 'task_1' })).toBe(true);
      expect(isScheduleConversation({ id: 'conv_task_1700000000000', type: 'chat' })).toBe(true);

      const title = formatScheduleRunTitle('每日晨報', new Date(2026, 10, 18, 7, 30).getTime());
      expect(title).toBe('每日晨報 (2026-11-18 07:30)');
    });

    it('creates independent dated runs and excludes history context unless explicitly enabled', async () => {
      const { executeScheduledTask } = await import('../scheduleEngine');
      const capturedMessages = [];
      const mockProvider = {
        chatStream({ messages }) {
          capturedMessages.push(messages);
          return (async function* () {
            yield {
              type: 'chunk',
              content: '完整分析報告內容。\n<widget-summary>今日大吉，穩健推進。</widget-summary>'
            };
            yield { type: 'done' };
          })();
        }
      };

      const task = {
        id: 'task_isolated',
        name: '每日分析',
        prompt: '分析今日重點',
        time: '08:00',
        repeat: 'daily',
        enabled: true,
        includeHistoryContext: false,
        runHistory: [
          {
            scheduleId: 'task_isolated',
            runId: 'run_old',
            executedAt: 1700000000000,
            status: 'success',
            summary: '舊的歷史摘要不應帶入'
          }
        ]
      };
      await LocalDB.saveScheduledTask(task);

      expect(buildScheduleHistoryContext(task)).toBe('');
      expect(buildScheduleHistoryContext({ ...task, includeHistoryContext: true })).toContain('舊的歷史摘要不應帶入');

      const run1 = await executeScheduledTask(task, {
        createProvider: () => mockProvider,
        startedAt: 1700100000000
      });

      expect(capturedMessages[0].some(m => m.content.includes('舊的歷史摘要不應帶入'))).toBe(false);
      expect(run1.lastRunSummary).toBe('今日大吉，穩健推進。');
      expect(run1.latestResult.summary).toBe('今日大吉，穩健推進。');
      expect(run1.latestResult.fullContent).toBe('完整分析報告內容。');
      expect(run1.runHistory.length).toBeGreaterThanOrEqual(2);

      const conv = await LocalDB.getConversation(run1.conversationId);
      expect(conv.type).toBe('schedule');
      expect(conv.scheduleId).toBe('task_isolated');
      expect(conv.runId).toBe(run1.latestRunId);
      expect(conv.title).toContain('每日分析 (');
    });

    it('shows explicit failure on widget when latest run fails instead of falling back to old success', async () => {
      const convOldId = 'conv_old_success';
      await LocalDB.saveConversation({ id: convOldId, title: '舊成功', type: 'schedule', createdAt: 1000 });
      await LocalDB.saveMessage({
        id: 'msg_old_ok',
        conversationId: convOldId,
        role: 'assistant',
        content: '這是過去成功的舊結果，失敗時不應顯示。',
        createdAt: 1001
      });

      await LocalDB.saveScheduledTask({
        id: 'task_fail_state',
        name: '每日新聞',
        prompt: '整理新聞',
        time: '09:00',
        repeat: 'daily',
        enabled: true,
        conversationId: convOldId,
        lastRunAt: 2000,
        lastRunStatus: 'failed',
        lastRunSummary: '⚠️ 失敗：HTTP 503 Service Unavailable',
        lastRunError: '[排程執行錯誤]: HTTP 503 Service Unavailable',
        latestResult: {
          scheduleId: 'task_fail_state',
          runId: 'run_fail_2000',
          executedAt: 2000,
          status: 'failed',
          summary: '⚠️ 失敗：HTTP 503 Service Unavailable',
          conversationId: convOldId
        }
      });

      const res = await syncWidgetAndNativeSchedules({ selectedTaskId: 'task_fail_state' });
      expect(res.widgetTasks[0].lastRunStatus).toBe('failed');
      expect(res.widgetTasks[0].summary).toContain('失敗');
      expect(res.widgetTasks[0].summary).not.toContain('過去成功的舊結果');
    });

    it('prevents older out-of-order async completion from overwriting newer latestResult', async () => {
      const { executeScheduledTask } = await import('../scheduleEngine');
      const taskId = 'task_async_order';

      await LocalDB.saveScheduledTask({
        id: taskId,
        name: '非同步順序保護',
        prompt: '測試',
        time: '08:00',
        repeat: 'daily',
        enabled: true,
        conversationId: 'conv_new_2000',
        latestRunId: 'run_new_2000',
        lastRunAt: 2000,
        lastRunStatus: 'success',
        lastRunSummary: '最新結果 2000',
        latestResult: {
          scheduleId: taskId,
          runId: 'run_new_2000',
          executedAt: 2000,
          completedAt: 2100,
          status: 'success',
          summary: '最新結果 2000',
          fullContent: '最新完整回覆 2000',
          conversationId: 'conv_new_2000'
        }
      });

      const oldMockProvider = {
        chatStream() {
          return (async function* () {
            yield { type: 'chunk', content: '<widget-summary>過時舊結果 1000</widget-summary>舊完整內容' };
            yield { type: 'done' };
          })();
        }
      };

      const result = await executeScheduledTask(
        { id: taskId, name: '非同步順序保護', prompt: '測試', enabled: true, repeat: 'daily' },
        { createProvider: () => oldMockProvider, startedAt: 1000, runId: 'run_old_1000' }
      );

      // Must preserve newer 2000 result as latest while still recording 1000 in runHistory
      expect(result.latestRunId).toBe('run_new_2000');
      expect(result.lastRunSummary).toBe('最新結果 2000');
      expect(result.latestResult.summary).toBe('最新結果 2000');
      expect(result.conversationId).toBe('conv_new_2000');
      expect(result.runHistory.some(r => r.runId === 'run_old_1000')).toBe(true);
    });
  });
});


