import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Plus, Trash } from 'lucide-react';
import ErrorBoundary from '../shared/ErrorBoundary';
import { formatTaiwanTime } from '../../utils/formatting';

export default function KeysPanel({
  keys,
  newKey,
  setNewKey,
  keyTestNotice,
  isTestingKeys,
  currentTimeMs,
  handleTestKeys,
  handleAddKey,
  handleDeleteKey
}) {
  const { t } = useTranslation();

  return (
    <ErrorBoundary name="KeysPanel">
      <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('keys.title')}</h2>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>{t('keys.description')}</p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-secondary"
              onClick={handleTestKeys}
              disabled={isTestingKeys || keys.length === 0}
            >
              <RefreshCw size={14} className={isTestingKeys ? 'animate-spin' : ''} />
              <span>{isTestingKeys ? t('keys.testing') : t('keys.testAll')}</span>
            </button>
          </div>
        </div>

        {keyTestNotice && (
          <div
            className={`sync-notice sync-notice-${keyTestNotice.type}`}
            role="status"
            aria-live="polite"
            style={{ alignSelf: 'flex-start' }}
          >
            {keyTestNotice.message}
          </div>
        )}

        <form onSubmit={handleAddKey} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="password"
            placeholder={t('keys.addPlaceholder')}
            className="input"
            style={{ flex: 1 }}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <button type="submit" className="btn btn-primary">
            <Plus size={16} />
            <span>{t('keys.addButton')}</span>
          </button>
        </form>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px' }}>{t('keys.apiKeyColumn')}</th>
                <th style={{ padding: '12px' }}>{t('keys.status')}</th>
                <th style={{ padding: '12px' }}>{t('keys.consecutiveFails')}</th>
                <th style={{ padding: '12px' }}>{t('keys.totalErrors')}</th>
                <th style={{ padding: '12px' }}>{t('keys.lastUsed')}</th>
                <th style={{ padding: '12px' }}>{t('keys.errorReason')}</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>{t('keys.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {t('keys.noKeys')}
                  </td>
                </tr>
              ) : (
                keys.map((k) => {
                  let badgeClass = 'badge-active';
                  let statusText = t('keys.active');
                  if (k.status === 'cooldown') {
                    const cooldownUntilMs = k.cooldown_until ? new Date(k.cooldown_until).getTime() : 0;
                    const secLeft = Math.max(0, Math.ceil((cooldownUntilMs - currentTimeMs) / 1000));
                    if (secLeft > 0) {
                      badgeClass = 'badge-cooldown';
                      statusText = t('keys.cooldown', { sec: secLeft });
                    } else {
                      badgeClass = 'badge-active';
                      statusText = t('keys.active');
                    }
                  } else if (k.status === 'inactive') {
                    badgeClass = 'badge-inactive';
                    statusText = t('keys.inactive');
                  }

                  return (
                    <tr key={k.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                        {k.masked_key || `nvapi-****...${k.key_suffix || ''}`}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span className={`badge ${badgeClass}`}>{statusText}</span>
                      </td>
                      <td style={{ padding: '12px', color: k.consecutive_failures > 0 ? 'var(--text-cooldown)' : 'inherit' }}>
                        {k.consecutive_failures}
                      </td>
                      <td style={{ padding: '12px', color: k.total_errors > 0 ? 'var(--text-inactive)' : 'inherit' }}>
                        {k.total_errors}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                        {k.last_used_at ? formatTaiwanTime(k.last_used_at) : t('keys.unused')}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-inactive)', fontSize: '13px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.last_error_message}>
                        {k.last_error_message || '--'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button className="btn btn-danger" style={{ padding: '6px 8px' }} onClick={() => handleDeleteKey(k.id)}>
                          <Trash size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ErrorBoundary>
  );
}
