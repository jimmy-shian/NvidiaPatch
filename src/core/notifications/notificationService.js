/**
 * Local Notification Service for Background Task / Stream Completion
 * Supports Capacitor LocalNotifications on native Android with Web Notification fallback.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export const NotificationService = {
  isInitialized: false,
  actionHandler: null,

  /**
   * Request Notification permission (essential for Android 13+ and Web)
   */
  async requestPermission() {
    try {
      if (Capacitor.isNativePlatform()) {
        const status = await LocalNotifications.checkPermissions();
        if (status.display !== 'granted') {
          const req = await LocalNotifications.requestPermissions();
          return req.display === 'granted';
        }
        return true;
      } else if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          return perm === 'granted';
        }
        return Notification.permission === 'granted';
      }
    } catch (e) {
      console.warn('[NotificationService] Failed to request permission:', e);
    }
    return false;
  },

  /**
   * Send background stream or task completion notification
   */
  async sendCompletionNotification({ conversationId, taskId = null, title, body, isError = false }) {
    try {
      const cleanTitle = title || (isError ? 'AI 回答發生錯誤' : 'AI 解卦/對話已完成');
      const rawBody = body || '';
      const stripBodyMeta = (str) => str
        .replace(/<options[\s\S]*?<\/options>/gi, '')
        .replace(/<options[\s\S]*/gi, '')
        .replace(/<option\b[^>]*?(?:\/>|>[\s\S]*?<\/option>)/gi, '')
        .replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>/gi, '')
        .replace(/<meihua-numbers[^>]*\/>/gi, '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
      const withoutThinkBody = stripBodyMeta(
        rawBody
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<think>[\s\S]*/gi, '')
      );
      const cleanBody = (withoutThinkBody || stripBodyMeta(rawBody.replace(/<\/?think>/gi, ''))).slice(0, 120);
      const finalBody = cleanBody || (isError ? '點擊查看錯誤詳情' : '點擊查看完整分析內容');

      if (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.showCompletionNotification === 'function') {
        window.NativeStreamBridge.showCompletionNotification(
          cleanTitle,
          finalBody,
          conversationId || '',
          taskId || '',
          Boolean(isError)
        );
        return;
      }

      if (Capacitor.isNativePlatform()) {
        // Generate positive 31-bit integer ID for notification
        const notificationId = Math.floor(Math.random() * 2147483647);
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notificationId,
              title: cleanTitle,
              body: finalBody,
              extra: { conversationId, taskId },
              schedule: { at: new Date(Date.now() + 100) },
              sound: 'default'
            }
          ]
        });
      } else if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          const n = new Notification(cleanTitle, {
            body: finalBody,
            data: { conversationId, taskId }
          });
          n.onclick = () => {
            window.focus();
            if (typeof window.__onNotificationClick === 'function') {
              window.__onNotificationClick(conversationId, taskId);
            }
          };
        }
      }
    } catch (e) {
      console.warn('[NotificationService] Send notification failed:', e);
    }
  },

  /**
   * Listen to user clicking a notification
   */
  initActionListener(onAction) {
    this.actionHandler = onAction;
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (Capacitor.isNativePlatform()) {
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const conversationId = action?.notification?.extra?.conversationId || null;
        const taskId = action?.notification?.extra?.taskId || null;
        if ((conversationId || taskId) && typeof this.actionHandler === 'function') {
          this.actionHandler(conversationId, taskId);
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.__onNotificationClick = (conversationId, taskId = null) => {
        if ((conversationId || taskId) && typeof this.actionHandler === 'function') {
          this.actionHandler(conversationId, taskId);
        }
      };
    }
  }
};
