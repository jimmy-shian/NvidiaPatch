import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, Key, Cpu, FileText, RotateCw, Loader2, Globe, Power, ShieldAlert, Play
} from 'lucide-react';
import packageJson from '../../../package.json';

const LANGUAGE_OPTIONS = [
  { code: 'zh-TW', label: '中' },
  { code: 'en-US', label: 'EN' },
  { code: 'ja-JP', label: '日' }
];

export default function Sidebar({
  activeTab,
  setActiveTab,
  stats,
  rulesCount,
  gatewayHealth,
  isRestartingGateway,
  handleRestartGateway,
  restartNotice,
  theme,
  setTheme,
  settingsData,
  setTempSettings,
  setIsSettingsModalOpen,
  handleRestartApp,
  apiError
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className="glass-panel" style={{ width: '240px', margin: '12px 6px 12px 12px', display: 'flex', flexDirection: 'column', padding: '20px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px', paddingLeft: '8px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-color) 0%, var(--blue-accent) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Activity size={18} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: '17px', fontWeight: '800', fontFamily: 'Outfit', letterSpacing: '0.5px' }}>{t('app.title')}</h1>
          <span style={{ fontSize: '13px', color: 'var(--accent-color)', fontWeight: '700' }}>{t('app.version', { version: packageJson.version })}</span>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>
        <button
          className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ justifyContent: 'flex-start', width: '100%' }}
          onClick={() => setActiveTab('dashboard')}
        >
          <Activity size={16} />
          <span>{t('nav.dashboard')}</span>
        </button>
        <button
          className={`btn ${activeTab === 'keys' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ justifyContent: 'flex-start', width: '100%' }}
          onClick={() => setActiveTab('keys')}
        >
          <Key size={16} />
          <span>{t('nav.keys', { active: stats.activeKeysCount, total: stats.keysCount })}</span>
        </button>
        <button
          className={`btn ${activeTab === 'models' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ justifyContent: 'flex-start', width: '100%' }}
          onClick={() => setActiveTab('models')}
        >
          <Cpu size={16} />
          <span>{t('nav.models', { count: stats.modelsCount })}</span>
        </button>
        <button
          className={`btn ${activeTab === 'playground' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ justifyContent: 'flex-start', width: '100%' }}
          onClick={() => setActiveTab('playground')}
        >
          <Play size={16} />
          <span>{t('nav.playground')}</span>
        </button>
        <button
          className={`btn ${activeTab === 'rules' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ justifyContent: 'flex-start', width: '100%' }}
          onClick={() => setActiveTab('rules')}
        >
          <FileText size={16} />
          <span>{t('nav.rules', { count: rulesCount })}</span>
        </button>
      </nav>

      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div className="glass-panel" style={{ padding: '10px 12px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                backgroundColor: gatewayHealth?.status === 'running' ? 'var(--status-active)' : (gatewayHealth === null ? 'var(--status-inactive)' : 'var(--status-cooldown)'),
                boxShadow: gatewayHealth?.status === 'running' ? '0 0 6px var(--status-active-glow-start)' : 'none'
              }} />
              <span style={{ fontSize: '12px', color: gatewayHealth?.status === 'running' ? 'var(--status-active)' : (gatewayHealth === null ? 'var(--status-inactive)' : 'var(--status-cooldown)'), fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {gatewayHealth?.status === 'running' ? t('dashboard.gatewayRunning') : (gatewayHealth === null ? t('dashboard.gatewayOffline') : t('dashboard.gatewayError'))}
              </span>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexShrink: 0 }}
              onClick={handleRestartGateway}
              disabled={isRestartingGateway}
              title={t('dashboard.restart')}
            >
              {isRestartingGateway ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
              <span>{isRestartingGateway ? t('dashboard.restarting') : t('dashboard.restart')}</span>
            </button>
          </div>
          {gatewayHealth?.status === 'running' && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('dashboard.uptime', { minutes: Math.round(gatewayHealth.uptime / 60) })}</span>
              <span>{t('dashboard.keysStatus', { active: gatewayHealth.keys?.active, total: gatewayHealth.keys?.total })}</span>
            </div>
          )}
        </div>

        {restartNotice && (
          <div
            className={`sync-notice sync-notice-${restartNotice.type}`}
            role="status"
            aria-live="polite"
            style={{ fontSize: '12px' }}
          >
            {restartNotice.type === 'info' && <Loader2 size={11} className="animate-spin" style={{ marginRight: '4px', flexShrink: 0, verticalAlign: 'middle' }} />}
            {restartNotice.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          {LANGUAGE_OPTIONS.map(lang => (
            <button
              key={lang.code}
              className={`btn ${i18n.language === lang.code ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '4px 8px', fontSize: '11px', minWidth: '32px' }}
              onClick={() => i18n.changeLanguage(lang.code)}
              title={lang.code}
            >
              <Globe size={10} style={{ marginRight: '2px' }} />
              <span>{lang.label}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => {
              setTempSettings({ ...settingsData });
              setIsSettingsModalOpen(true);
            }}
            className="btn btn-secondary"
            style={{ flex: 1, padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            ⚙️ {t('settings.settingsButton')}
          </button>
          <button
            onClick={() => setTheme(prev => prev === 'theme-dark' ? 'theme-light' : 'theme-dark')}
            className="btn btn-secondary"
            style={{ padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={t('common.toggleTheme')}
          >
            {theme === 'theme-dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <button
          className="btn btn-danger"
          style={{ padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          onClick={handleRestartApp}
          title={t('dashboard.restartApp')}
        >
          <Power size={14} />
          <span>{t('dashboard.restartApp')}</span>
        </button>
      </div>

      {apiError && (
        <div className="glass-panel badge-inactive" style={{ padding: '12px', fontSize: '13px', borderRadius: '8px', marginTop: '12px', whiteSpace: 'normal', lineHeight: '1.4' }}>
          <ShieldAlert size={14} style={{ marginRight: '6px', flexShrink: 0 }} />
          {apiError}
        </div>
      )}
    </div>
  );
}
