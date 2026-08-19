import { useState, useRef, useEffect, useCallback } from 'react';

export default function useLogsState(api) {
  const [logs, setLogs] = useState([]);
  const sseLogsBufferRef = useRef([]);
  const sseLogsTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (sseLogsTimeoutRef.current) clearTimeout(sseLogsTimeoutRef.current);
    };
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const data = await api.fetchLogs();
      if (data) setLogs(data);
      return data;
    } catch (err) {
      console.error('Failed to load logs:', err);
      return [];
    }
  }, [api]);

  const handleSseLog = useCallback((logData) => {
    sseLogsBufferRef.current.push(logData);
    if (!sseLogsTimeoutRef.current) {
      sseLogsTimeoutRef.current = setTimeout(() => {
        setLogs(prev => {
          const updated = [...prev, ...sseLogsBufferRef.current];
          sseLogsBufferRef.current = [];
          return updated.length > 100 ? updated.slice(-100) : updated;
        });
        sseLogsTimeoutRef.current = null;
      }, 150);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    logs,
    setLogs,
    loadLogs,
    handleSseLog,
    clearLogs
  };
}
