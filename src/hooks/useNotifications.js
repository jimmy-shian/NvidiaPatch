import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 系統通知 hook
 * 在重要狀態變更時觸發 OS notification 或 App 內通知
 */
export default function useNotifications() {
  const { t } = useTranslation();
  const [permission, setPermission] = useState('default');
  const lastNotifyRef = useRef({});
  const COOLDOWN_MS = 5 * 60 * 1000;

  const sendNotification = useCallback((title, body, tag) => {
    const now = Date.now();
    if (lastNotifyRef.current[tag] && now - lastNotifyRef.current[tag] < COOLDOWN_MS) {
      return null;
    }
    lastNotifyRef.current[tag] = now;

    if (window.electronAPI && typeof window.electronAPI.sendNotification === 'function') {
      try {
        window.electronAPI.sendNotification(title, body);
        return null;
      } catch (err) {
        console.error('Failed to send notification via electronAPI:', err);
      }
    }

    if (permission === 'granted') {
      try {
        return new Notification(title, { body, tag });
      } catch (_) {
        // ignore
      }
    }
    return null;
  }, [permission]);

  useEffect(() => {
    if (!('Notification' in window)) return;
    setPermission(Notification.permission);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'denied';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const notifyAllKeysDown = useCallback(() => {
    sendNotification(
      t('notifications.allKeysDown.title'),
      t('notifications.allKeysDown.body'),
      'all-keys-down'
    );
  }, [sendNotification, t]);

  const notifyAllModelsDegraded = useCallback(() => {
    sendNotification(
      t('notifications.allModelsDegraded.title'),
      t('notifications.allModelsDegraded.body'),
      'all-models-degraded'
    );
  }, [sendNotification, t]);

  return { permission, requestPermission, notifyAllKeysDown, notifyAllModelsDegraded };
}