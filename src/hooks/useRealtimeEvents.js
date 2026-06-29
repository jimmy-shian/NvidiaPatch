import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * SSE 即時事件推送 hook
 * 連接到 /api/events，自動處理重連與斷線復原
 */
export default function useRealtimeEvents(gatewayUrl, adminToken, handlers) {
  const [connected, setConnected] = useState(false);
  const retryTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  const connect = useCallback(() => {
    if (!adminToken) return;

    const url = `${gatewayUrl}/api/events?token=${encodeURIComponent(adminToken)}`;
    const es = new EventSource(url);

    const onOpen = () => {
      setConnected(true);
      retryCountRef.current = 0;
    };

    const onError = () => {
      setConnected(false);
      es.close();

      const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
      retryCountRef.current += 1;

      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = setTimeout(() => {
        connect();
      }, retryDelay);
    };

    const addHandler = (event, handler) => {
      es.addEventListener(event, (e) => {
        try {
          const data = JSON.parse(e.data);
          handler(data);
        } catch (err) {
          console.error(`SSE ${event} parse error:`, err);
        }
      });
    };

    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);

    if (handlerRef.current.onLogs) addHandler('logs', handlerRef.current.onLogs);
    if (handlerRef.current.onStats) addHandler('stats', handlerRef.current.onStats);
    if (handlerRef.current.onKeys) addHandler('keys', handlerRef.current.onKeys);
    if (handlerRef.current.onModels) addHandler('models', handlerRef.current.onModels);
    if (handlerRef.current.onRules) addHandler('rules', handlerRef.current.onRules);
    if (handlerRef.current.onSettings) addHandler('settings', handlerRef.current.onSettings);
    if (handlerRef.current.onTokenUsage) addHandler('token-usage', handlerRef.current.onTokenUsage);
    es.addEventListener('connected', onOpen);

    return () => {
      setConnected(false);
      es.close();
    };
  }, [gatewayUrl, adminToken]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (cleanup) cleanup();
    };
  }, [connect]);

  return connected;
}