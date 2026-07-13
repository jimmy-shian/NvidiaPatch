import React, { useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import ErrorBoundary from '../shared/ErrorBoundary';
import { translateLogMessage } from '../../i18n/logTranslator';
import { formatTaiwanTime } from '../../utils/formatting';

export default function LogsPanel({
  logs,
  fetchData,
  theme
}) {
  const { t, i18n } = useTranslation();
  const localLogsContainerRef = useRef(null);
  const localShouldAutoFollowLogsRef = useRef(true);

  const isLogPanelNearBottom = () => {
    const el = localLogsContainerRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= 24;
  };

  const handleLogsScroll = () => {
    localShouldAutoFollowLogsRef.current = isLogPanelNearBottom();
  };

  // Scroll to bottom on initial render and when logs update, if user is near bottom
  useEffect(() => {
    if (localShouldAutoFollowLogsRef.current && localLogsContainerRef.current) {
      localLogsContainerRef.current.scrollTo({ top: localLogsContainerRef.current.scrollHeight, behavior: 'auto' });
    }
  }, [logs]);

  const renderedLogRows = useMemo(() => {
    return logs.map((log, index) => {
      if (!log) return null;

      let logColor = 'var(--log-info)';
      let icon = 'ℹ️';

      if (log.type === 'success') {
        logColor = 'var(--log-success)';
        icon = '✅';
      } else if (log.type === 'warning') {
        logColor = 'var(--log-warning)';
        icon = '⚠️';
      } else if (log.type === 'error') {
        logColor = 'var(--log-error)';
        icon = '❌';
      }

      return (
        <div key={`${log.timestamp || 'log'}-${log.id || index}`} className="terminal-log-line">
          <span className="terminal-log-time">
            [{formatTaiwanTime(log.timestamp)}]
          </span>
          <span className="terminal-log-icon">
            {icon}
          </span>
          <span
            className="terminal-log-message"
            style={{ color: logColor }}
          >
            {translateLogMessage(log.message, i18n.language)}
          </span>
        </div>
      );
    });
  }, [logs, theme, i18n.language]);

  return (
    <ErrorBoundary name="DashboardLogs">
      <div className="glass-panel" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={14} className={logs.length > 0 ? 'animate-spin' : ''} style={{ animationDuration: '3s', color: 'var(--accent-color)' }} />
            <span style={{ fontSize: '16px', fontWeight: '700' }}>{t('dashboard.logTitle')}</span>
          </div>
          <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={fetchData}>
            {t('dashboard.refresh')}
          </button>
        </div>

        <div className="terminal-log-panel">
          {logs.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px' }}>
              {t('dashboard.waiting')}
            </div>
          ) : (
            <div
              ref={localLogsContainerRef}
              className="terminal-log-lines"
              onScroll={handleLogsScroll}
            >
              {renderedLogRows}
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
