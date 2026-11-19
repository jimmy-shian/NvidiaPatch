import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../notificationService';
import { LocalNotifications } from '@capacitor/local-notifications';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true
  }
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
    schedule: vi.fn().mockResolvedValue({}),
    addListener: vi.fn()
  }
}));

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests notification permission on native platform', async () => {
    const granted = await NotificationService.requestPermission();
    expect(granted).toBe(true);
    expect(LocalNotifications.checkPermissions).toHaveBeenCalled();
  });

  it('schedules notification with clean title and truncated body', async () => {
    const longText = '這是一段非常長的解卦回答內容。'.repeat(20);
    await NotificationService.sendCompletionNotification({
      conversationId: 'conv_123',
      title: '乾為天卦象解析',
      body: longText,
      isError: false
    });

    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1);
    const callArgs = LocalNotifications.schedule.mock.calls[0][0];
    const n = callArgs.notifications[0];

    expect(n.title).toBe('乾為天卦象解析');
    expect(n.body.length).toBeLessThanOrEqual(120);
    expect(n.extra.conversationId).toBe('conv_123');
  });

  it('handles error notification gracefully', async () => {
    await NotificationService.sendCompletionNotification({
      conversationId: 'conv_error',
      title: '',
      body: '網路連線逾時',
      isError: true
    });

    const callArgs = LocalNotifications.schedule.mock.calls[0][0];
    const n = callArgs.notifications[0];
    expect(n.title).toBe('AI 回答發生錯誤');
    expect(n.body).toBe('網路連線逾時');
  });

  it('prefers NativeStreamBridge.showCompletionNotification and strips <think>/<options> tags', async () => {
    const originalWindow = globalThis.window;
    const showSpy = vi.fn();
    globalThis.window = {
      NativeStreamBridge: {
        showCompletionNotification: showSpy
      }
    };

    try {
      await NotificationService.sendCompletionNotification({
        conversationId: 'conv_bridge_1',
        taskId: 'task_bridge_1',
        title: '排程完成：運勢',
        body: '<think>思考內容</think>今日諸事順遂。<options title="下一步"><option label="詳解" /></options>',
        isError: false
      });

      expect(showSpy).toHaveBeenCalledTimes(1);
      expect(showSpy).toHaveBeenCalledWith(
        '排程完成：運勢',
        '今日諸事順遂。',
        'conv_bridge_1',
        'task_bridge_1',
        false
      );
      expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('updates actionHandler on subsequent initActionListener calls without duplicate listeners', () => {
    const originalWindow = globalThis.window;
    globalThis.window = {};
    NotificationService.isInitialized = false;

    try {
      const firstCb = vi.fn();
      const secondCb = vi.fn();

      NotificationService.initActionListener(firstCb);
      NotificationService.initActionListener(secondCb);

      expect(LocalNotifications.addListener).toHaveBeenCalledTimes(1);

      globalThis.window.__onNotificationClick('conv_99', 'task_99');
      expect(firstCb).not.toHaveBeenCalled();
      expect(secondCb).toHaveBeenCalledWith('conv_99', 'task_99');
    } finally {
      globalThis.window = originalWindow;
      NotificationService.isInitialized = false;
    }
  });
});
