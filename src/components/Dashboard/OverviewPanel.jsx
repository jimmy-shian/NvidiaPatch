import React from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Activity, Key, Cpu } from 'lucide-react';
import HourlyChart from './HourlyChart';

export default function OverviewPanel({
  stats,
  models,
  activeModelGroup,
  copiedId,
  copyToClipboard,
  getTotalRequests,
  calculateSuccessRate,
  getGatewayUrl,
  hoveredHourlyIndex,
  setHoveredHourlyIndex
}) {
  const { t } = useTranslation();
  const gatewayUrl = getGatewayUrl();

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div
          className="glass-panel"
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onClick={() => copyToClipboard('http://127.0.0.1:4000/v1', 'gateway_endpoint')}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
          title={t('app.copyToClipboard')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('app.endpoint')}</span>
            {copiedId === 'gateway_endpoint' ? (
              <span style={{ fontSize: '13px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                <Check size={12} />{t('app.copyToClipboard')}
              </span>
            ) : (
              <Copy size={12} style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
          <span style={{ fontSize: '17px', fontWeight: '700', color: 'var(--accent-color)', fontFamily: 'Outfit' }}>http://127.0.0.1:4000/v1</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--status-active)' }}></div>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('app.copyToClipboard')} (Port 4000)</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('dashboard.activeKeys')}</span>
          <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'Outfit' }}>
            {stats.activeKeysCount} <span style={{ fontSize: '16px', color: 'var(--text-secondary)', fontWeight: '400' }}>/ {stats.keysCount}</span>
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('dashboard.cooldownPool')}</span>
        </div>

        <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('dashboard.recentRequests')}</span>
          <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'Outfit' }}>
            {getTotalRequests()} <span style={{ fontSize: '16px', color: 'var(--accent-color)', fontWeight: '600' }}>({calculateSuccessRate()})</span>
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('dashboard.only429Triggers')}</span>
        </div>

        <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('dashboard.primaryModel')}</span>
          <span style={{ fontSize: '16px', fontWeight: '700', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={models[0]?.model_id || '--'}>
            {models[0] ? models[0].model_id.split('/').pop() : '--'}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('dashboard.priority', { n: 1 })}</span>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--accent-color)' }}>⚙️ {t('dashboard.openaiTitle')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <div
            style={{
              background: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '8px',
              position: 'relative',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => copyToClipboard('myself', 'prov_id')}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
            title={t('dashboard.copyProviderId')}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.providerId')}</div>
            <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>myself</div>
            <div
              className="btn btn-secondary"
              style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {copiedId === 'prov_id' ? <Check size={12} /> : <Copy size={12} />}
            </div>
          </div>
          <div
            style={{
              background: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '8px',
              position: 'relative',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => copyToClipboard(gatewayUrl + '/v1', 'prov_url')}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
            title={t('dashboard.copyBaseUrl')}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.baseUrl')}</div>
            <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>{gatewayUrl}/v1</div>
            <div
              className="btn btn-secondary"
              style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {copiedId === 'prov_url' ? <Check size={12} /> : <Copy size={12} />}
            </div>
          </div>
          <div
            style={{
              background: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '8px',
              position: 'relative',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => copyToClipboard(String(activeModelGroup), 'prov_key')}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
            title={t('dashboard.copyApiKey')}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.apiKeyGroup')}</div>
            <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>1 / 2 / 3</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{t('dashboard.apiKeyGroupText', { group: activeModelGroup })}</div>
            <div
              className="btn btn-secondary"
              style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {copiedId === 'prov_key' ? <Check size={12} /> : <Copy size={12} />}
            </div>
          </div>
          <div
            style={{
              background: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: '8px',
              position: 'relative',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => copyToClipboard('patcher-main', 'prov_model')}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
            title={t('dashboard.copyModelId')}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.modelId')}</div>
            <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>patcher-main</div>
            <div
              className="btn btn-secondary"
              style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {copiedId === 'prov_model' ? <Check size={12} /> : <Copy size={12} />}
            </div>
          </div>
        </div>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {t('dashboard.providerTip')}
        </span>
      </div>

      <HourlyChart
        hourlyStats={stats.hourly}
        hoveredHourlyIndex={hoveredHourlyIndex}
        setHoveredHourlyIndex={setHoveredHourlyIndex}
      />
    </>
  );
}
