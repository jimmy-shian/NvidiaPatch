import { useEffect, useRef, useCallback, useState } from 'react';

const SSE_HEALTH_TIMEOUT_MS = 35000;
const SSE_MAX_RETRIES = 50;
const LOG_FLUSH_MS = 1000;
const STATE_FLUSH_MS = 5000;
const MAX_PENDING_LOGS = 100;

export default function useRealtimeEvents(gatewayUrl, adminToken, handlers) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);
  const intervalRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  const logFlushTimeoutRef = useRef(null);
  const stateFlushTimeoutRef = useRef(null);
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

  const flushLogs = useCallback(() => {
    logFlushTimeoutRef.current = null;
    const pending = pendingUpdatesRef.current;
    const handlers = handlerRef.current;
    if (pending.logs.length === 0 || !handlers.onLogs) {
      pending.logs = [];
      return;
    }

    const logs = pending.logs.splice(0, pending.logs.length);
    logs.forEach(log => {
      try { handlers.onLogs(log); } catch (e) { console.error(e); }
    });
  }, []);

  const flushStateUpdates = useCallback(() => {
    stateFlushTimeoutRef.current = null;
    const pending = pendingUpdatesRef.current;
    const tasks = [];

    if (pending.health !== null) {
      const h = pending.health;
      tasks.push(() => {
        if (handlerRef.current.onHealth) {
          try { handlerRef.current.onHealth(h); } catch (e) { console.error(e); }
        }
      });
      pending.health = null;
    }

    if (pending.stats !== null) {
      const s = pending.stats;
      tasks.push(() => {
        if (handlerRef.current.onStats) {
          try { handlerRef.current.onStats(s); } catch (e) { console.error(e); }
        }
      });
      pending.stats = null;
    }

    if (pending.settings !== null) {
      const set = pending.settings;
      tasks.push(() => {
        if (handlerRef.current.onSettings) {
          try { handlerRef.current.onSettings(set); } catch (e) { console.error(e); }
        }
      });
      pending.settings = null;
    }

    if (pending.keys !== null) {
      const k = pending.keys;
      tasks.push(() => {
        if (handlerRef.current.onKeys) {
          try { handlerRef.current.onKeys(k); } catch (e) { console.error(e); }
        }
      });
      pending.keys = null;
    }

    if (pending.models) {
      tasks.push(() => {
        if (handlerRef.current.onModels) {
          try { handlerRef.current.onModels(); } catch (e) { console.error(e); }
        }
      });
      pending.models = false;
    }

    if (pending.rules) {
      tasks.push(() => {
        if (handlerRef.current.onRules) {
          try { handlerRef.current.onRules(); } catch (e) { console.error(e); }
        }
      });
      pending.rules = false;
    }

    if (pending.tokenUsage) {
      tasks.push(() => {
        if (handlerRef.current.onTokenUsage) {
          try { handlerRef.current.onTokenUsage(); } catch (e) { console.error(e); }
        }
      });
      pending.tokenUsage = false;
    }

    if (tasks.length > 0) {
      let index = 0;
      const runNextTask = () => {
        if (index < tasks.length) {
          tasks[index]();
          index++;
          if (index < tasks.length) {
            requestAnimationFrame(runNextTask);
          }
        }
      };
      runNextTask();
    }
  }, []);

  const requestUpdate = useCallback((typeKey) => {
    if (typeKey === 'logs') {
      if (!logFlushTimeoutRef.current) {
        logFlushTimeoutRef.current = setTimeout(flushLogs, LOG_FLUSH_MS);
      }
      return;
    }

    if (!stateFlushTimeoutRef.current) {
      stateFlushTimeoutRef.current = setTimeout(flushStateUpdates, STATE_FLUSH_MS);
    }
  }, [flushLogs, flushStateUpdates]);

  const connect = useCallback(() => {
    if (!adminToken) return;

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

      if (intervalElapsed > 18000) {
        console.warn(`[SSE] Health check interval delayed by ${intervalElapsed}ms due to client throttling/dragging. Adjusting lastHealthTime.`);
        lastHealthTime = now;
        return;
      }

      if (now - lastHealthTime > SSE_HEALTH_TIMEOUT_MS) {
        console.warn('[SSE] No health heartbeat received for', SSE_HEALTH_TIMEOUT_MS, 'ms - forcing reconnect');
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
            if (pendingUpdatesRef.current.logs.length > MAX_PENDING_LOGS) {
              pendingUpdatesRef.current.logs.splice(0, pendingUpdatesRef.current.logs.length - MAX_PENDING_LOGS);
            }
          } else if (typeKey === 'models' || typeKey === 'rules' || typeKey === 'tokenUsage') {
            pendingUpdatesRef.current[typeKey] = true;
          } else {
            pendingUpdatesRef.current[typeKey] = data;
          }

          requestUpdate(typeKey);
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
          requestUpdate('health');
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
      if (logFlushTimeoutRef.current) {
        clearTimeout(logFlushTimeoutRef.current);
        logFlushTimeoutRef.current = null;
      }
      if (stateFlushTimeoutRef.current) {
        clearTimeout(stateFlushTimeoutRef.current);
        stateFlushTimeoutRef.current = null;
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