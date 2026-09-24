/**
 * Local Notification Service for Background Task / Stream Completion
 * Supports Capacitor LocalNotifications on native Android with Web Notification fallback.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export const NotificationService = {
  isInitialized: false,

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
  async sendCompletionNotification({ conversationId, title, body, isError = false }) {
    try {
      const cleanTitle = title || (isError ? 'AI 回答發生錯誤' : 'AI 解卦/對話已完成');
      const cleanBody = (body || '').replace(/[\r\n]+/g, ' ').slice(0, 120);

      if (Capacitor.isNativePlatform()) {
        // Generate positive 31-bit integer ID for notification
        const notificationId = Math.floor(Math.random() * 2147483647);
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notificationId,
              title: cleanTitle,
              body: cleanBody || (isError ? '點擊查看錯誤詳情' : '點擊查看完整分析內容'),
              extra: { conversationId },
              schedule: { at: new Date(Date.now() + 100) },
              sound: 'default'
            }
          ]
        });
      } else if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          const n = new Notification(cleanTitle, {
            body: cleanBody,
            data: { conversationId }
          });
          n.onclick = () => {
            window.focus();
            if (typeof window.__onNotificationClick === 'function') {
              window.__onNotificationClick(conversationId);
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
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (Capacitor.isNativePlatform()) {
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const conversationId = action?.notification?.extra?.conversationId;
        if (conversationId && typeof onAction === 'function') {
          onAction(conversationId);
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.__onNotificationClick = (conversationId) => {
        if (conversationId && typeof onAction === 'function') {
          onAction(conversationId);
        }
      };
    }
  }
};
