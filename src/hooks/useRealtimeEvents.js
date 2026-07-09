import { useEffect, useRef, useCallback, useState } from 'react';

const SSE_HEALTH_TIMEOUT_MS = 35000;
const SSE_MAX_RETRIES = 50;

export default function useRealtimeEvents(gatewayUrl, adminToken, handlers) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);
  const intervalRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  const throttleTimeoutRef = useRef(null);
  const lastExecutionTimeRef = useRef(0);
  const pendingUpdatesRef = useRef({
    logs: [],
    stats: null,
    keys: null,
    models: false,
    rules: false,
    settings: null,
    tokenUsage: false,
    health: null
  });

  const flushUpdates = useCallback(() => {
    const pending = pendingUpdatesRef.current;
    const handlers = handlerRef.current;

    if (pending.logs.length > 0) {
      if (handlers.onLogs) {
        pending.logs.forEach(log => {
          try { handlers.onLogs(log); } catch (e) { console.error(e); }
        });
      }
      pending.logs = [];
    }

    if (pending.stats !== null) {
      if (handlers.onStats) {
        try { handlers.onStats(pending.stats); } catch (e) { console.error(e); }
      }
      pending.stats = null;
    }

    if (pending.keys !== null) {
      if (handlers.onKeys) {
        try { handlers.onKeys(pending.keys); } catch (e) { console.error(e); }
      }
      pending.keys = null;
    }

    if (pending.models) {
      if (handlers.onModels) {
        try { handlers.onModels(); } catch (e) { console.error(e); }
      }
      pending.models = false;
    }

    if (pending.rules) {
      if (handlers.onRules) {
        try { handlers.onRules(); } catch (e) { console.error(e); }
      }
      pending.rules = false;
    }

    if (pending.settings !== null) {
      if (handlers.onSettings) {
        try { handlers.onSettings(pending.settings); } catch (e) { console.error(e); }
      }
      pending.settings = null;
    }

    if (pending.tokenUsage) {
      if (handlers.onTokenUsage) {
        try { handlers.onTokenUsage(); } catch (e) { console.error(e); }
      }
      pending.tokenUsage = false;
    }

    if (pending.health !== null) {
      if (handlers.onHealth) {
        try { handlers.onHealth(pending.health); } catch (e) { console.error(e); }
      }
      pending.health = null;
    }
  }, []);

  const requestUpdate = useCallback(() => {
    if (throttleTimeoutRef.current) return;

    const now = Date.now();
    const timeSinceLast = now - lastExecutionTimeRef.current;

    if (timeSinceLast >= 3000) {
      flushUpdates();
      lastExecutionTimeRef.current = Date.now();
    } else {
      throttleTimeoutRef.current = setTimeout(() => {
        flushUpdates();
        lastExecutionTimeRef.current = Date.now();
        throttleTimeoutRef.current = null;
      }, 3000 - timeSinceLast);
    }
  }, [flushUpdates]);

  const connect = useCallback(() => {
    if (!adminToken) return;

    // Clean up any existing connection/interval before starting a new one
    if (esRef.current) {
      try { esRef.current.close(); } catch (_) {}
      esRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const url = `${gatewayUrl}/api/events?token=${encodeURIComponent(adminToken)}`;
    const es = new EventSource(url);
    esRef.current = es;

    let lastHealthTime = Date.now();
    let lastIntervalTime = Date.now();

    const healthCheckInterval = setInterval(() => {
      const now = Date.now();
      const intervalElapsed = now - lastIntervalTime;
      lastIntervalTime = now;

      // 如果 interval 被瀏覽器/OS 延遲了 (例如視窗移動、最小化、系統休眠)，
      // 則不應該判定為伺服器斷線。我們將最後收到心跳的時間順延，避免觸發誤判的斷線重連。
      if (intervalElapsed > 18000) {
        console.warn(`[SSE] Health check interval delayed by ${intervalElapsed}ms due to client throttling/dragging. Adjusting lastHealthTime.`);
        lastHealthTime = now;
        return;
      }

      if (now - lastHealthTime > SSE_HEALTH_TIMEOUT_MS) {
        console.warn('[SSE] No health heartbeat received for', SSE_HEALTH_TIMEOUT_MS, 'ms — forcing reconnect');
        setConnected(false);
        es.close();
        clearInterval(healthCheckInterval);
        if (esRef.current === es) esRef.current = null;
        if (intervalRef.current === healthCheckInterval) intervalRef.current = null;

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
    intervalRef.current = healthCheckInterval;

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
      if (esRef.current === es) esRef.current = null;
      if (intervalRef.current === healthCheckInterval) intervalRef.current = null;

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

    const addHandler = (event, typeKey, hasData = true) => {
      es.addEventListener(event, (e) => {
        try {
          let data = null;
          if (hasData) {
            data = JSON.parse(e.data);
          }
          
          if (typeKey === 'logs') {
            pendingUpdatesRef.current.logs.push(data);
          } else if (typeKey === 'models' || typeKey === 'rules' || typeKey === 'tokenUsage') {
            pendingUpdatesRef.current[typeKey] = true;
          } else {
            pendingUpdatesRef.current[typeKey] = data;
          }

          requestUpdate();
        } catch (err) {
          console.error(`SSE ${event} parse error:`, err);
        }
      });
    };

    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);

    if (handlerRef.current.onLogs) addHandler('logs', 'logs');
    if (handlerRef.current.onStats) addHandler('stats', 'stats');
    if (handlerRef.current.onKeys) addHandler('keys', 'keys');
    if (handlerRef.current.onModels) addHandler('models', 'models', false);
    if (handlerRef.current.onRules) addHandler('rules', 'rules', false);
    if (handlerRef.current.onSettings) addHandler('settings', 'settings');
    if (handlerRef.current.onTokenUsage) addHandler('token-usage', 'tokenUsage', false);
    if (handlerRef.current.onHealth) {
      es.addEventListener('health', (e) => {
        try {
          const data = JSON.parse(e.data);
          lastHealthTime = Date.now();
          pendingUpdatesRef.current.health = data;
          requestUpdate();
        } catch (err) {
          console.error('SSE health parse error:', err);
        }
      });
    }
    es.addEventListener('connected', onOpen);

  }, [gatewayUrl, adminToken, requestUpdate]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setConnected(false);
    };
  }, [connect]);

  return connected;
}
