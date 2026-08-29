import { useState, useCallback, useRef } from 'react';

/**
 * 簡易浮動 Toast 通知 Hook
 * 預設停留時間改為 1.5 秒 (1500ms)
 */
export default function useToast(defaultDuration = 1500) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type, message, duration = defaultDuration) => {
    if (!message) return null;
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast = { id, type, message };

    setToasts((prev) => [...prev, newToast]);

    const timer = setTimeout(() => {
      removeToast(id);
    }, duration);

    timersRef.current.set(id, timer);
    return id;
  }, [defaultDuration, removeToast]);

  return { toasts, showToast, removeToast };
}
