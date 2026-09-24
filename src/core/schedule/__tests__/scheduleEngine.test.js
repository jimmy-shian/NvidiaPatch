import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateNextRunTime, writeWidgetLatestTask } from '../scheduleEngine';
import { Preferences } from '@capacitor/preferences';
import { LocalDB } from '../../storage/localDatabase';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue({})
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
  });
});
