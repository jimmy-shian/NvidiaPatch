import { useEffect, useRef, useCallback, useState } from 'react';

const SSE_HEALTH_TIMEOUT_MS = 35000;
const SSE_MAX_RETRIES = 50;

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
    let lastHealthTime = Date.now();

    const healthCheckInterval = setInterval(() => {
      if (Date.now() - lastHealthTime > SSE_HEALTH_TIMEOUT_MS) {
        console.warn('[SSE] No health heartbeat received for', SSE_HEALTH_TIMEOUT_MS, 'ms — forcing reconnect');
        setConnected(false);
        es.close();
        clearInterval(healthCheckInterval);

        const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current += 1;

        if (retryCountRef.current > SSE_MAX_RETRIES) {
          console.error('[SSE] Max retries exceeded. Stopping reconnection.');
          return;
        }

        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          connect();
        }, retryDelay);
      }
    }, 15000);

    const onOpen = () => {
      setConnected(true);
      retryCountRef.current = 0;
      lastHealthTime = Date.now();

      if (handlerRef.current.onReconnect) {
        handlerRef.current.onReconnect();
      }
    };

    const onError = () => {
      setConnected(false);
      es.close();
      clearInterval(healthCheckInterval);

      const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
      retryCountRef.current += 1;

      if (retryCountRef.current > SSE_MAX_RETRIES) {
        console.error('[SSE] Max retries exceeded. Stopping reconnection.');
        return;
      }

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
    if (handlerRef.current.onHealth) {
      addHandler('health', (data) => {
        lastHealthTime = Date.now();
        handlerRef.current.onHealth(data);
      });
    }
    es.addEventListener('connected', onOpen);

    return () => {
      clearInterval(healthCheckInterval);
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
