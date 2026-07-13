import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  tempSettings,
  setTempSettings,
  settingsData,
  setIsSettingsModalOpen,
  saveSettings
}) {
  const { t } = useTranslation();

  if (!isOpen || !tempSettings) return null;

  return (
    <div
      onClick={() => setIsSettingsModalOpen(false)}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'var(--modal-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(2px)'
      }}
    >
      <div
        className="glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '500px',
          maxWidth: '95vw',
          boxSizing: 'border-box',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          maxHeight: '90vh',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'Outfit' }}>⚙️ {t('settings.title')}</h3>
          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setIsSettingsModalOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.nvidiaUrl')}</label>
            <input
              className="input"
              type="text"
              value={tempSettings.NVIDIA_API_URL || ''}
              onChange={(e) => setTempSettings({ ...tempSettings, NVIDIA_API_URL: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.gatewayPort')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.PORT || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, PORT: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.maxRounds')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.MAX_ROUNDS_PER_MODEL || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, MAX_ROUNDS_PER_MODEL: Number(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.roundDelay')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.ROUND_DELAY_MS || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, ROUND_DELAY_MS: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.requestTimeout')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.REQUEST_TIMEOUT_MS || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, REQUEST_TIMEOUT_MS: Number(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.streamTimeout')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.STREAM_READ_TIMEOUT_MS || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, STREAM_READ_TIMEOUT_MS: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.testTimeout')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.TEST_TIMEOUT_MS || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, TEST_TIMEOUT_MS: Number(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.modelCooldown')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.MODEL_FAILURE_COOLDOWN_MS || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, MODEL_FAILURE_COOLDOWN_MS: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.keyConcurrencyDelay')}</label>
              <input
                className="input"
                type="number"
                value={tempSettings.KEY_CONCURRENCY_DELAY_MS || ''}
                onChange={(e) => setTempSettings({ ...tempSettings, KEY_CONCURRENCY_DELAY_MS: Number(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px', fontWeight: '700', color: 'var(--accent-color)', fontSize: '15px' }}>
            💰 {t('settings.pricing')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.promptPrice')}</label>
              <input className="input" type="number" step="0.01"
                value={tempSettings.PRICE_PER_MILLION_PROMPT_TOKENS || 0}
                onChange={(e) => setTempSettings({ ...tempSettings, PRICE_PER_MILLION_PROMPT_TOKENS: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.completionPrice')}</label>
              <input className="input" type="number" step="0.01"
                value={tempSettings.PRICE_PER_MILLION_COMPLETION_TOKENS || 0}
                onChange={(e) => setTempSettings({ ...tempSettings, PRICE_PER_MILLION_COMPLETION_TOKENS: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.currency')}</label>
              <input className="input" type="text"
                value={tempSettings.CURRENCY_SYMBOL || 'USD'}
                onChange={(e) => setTempSettings({ ...tempSettings, CURRENCY_SYMBOL: e.target.value })}
              />
            </div>
          </div>

          <div style={{ marginTop: '8px', fontWeight: '700', color: 'var(--text-secondary)', fontSize: '14px' }}>
            ⚖️ {t('settings.refPricing')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.refPromptPrice')}</label>
              <input className="input" type="number" step="0.01"
                value={tempSettings.REF_PRICE_PER_MILLION_PROMPT_TOKENS || 0}
                onChange={(e) => setTempSettings({ ...tempSettings, REF_PRICE_PER_MILLION_PROMPT_TOKENS: Number(e.target.value) })}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.refCompletionPrice')}</label>
              <input className="input" type="number" step="0.01"
                value={tempSettings.REF_PRICE_PER_MILLION_COMPLETION_TOKENS || 0}
                onChange={(e) => setTempSettings({ ...tempSettings, REF_PRICE_PER_MILLION_COMPLETION_TOKENS: Number(e.target.value) })}
              />
            </div>
          </div>

          {tempSettings.PORT !== settingsData.PORT && (
            <div style={{ fontSize: '12px', color: 'var(--status-cooldown)', marginTop: '4px', fontWeight: '500' }}>
              ⚠️ {t('settings.portNotice')}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <button className="btn btn-secondary" onClick={() => setIsSettingsModalOpen(false)}>
            {t('settings.cancel')}
          </button>
          <button className="btn btn-primary" onClick={async () => {
            await saveSettings(tempSettings);
            setIsSettingsModalOpen(false);
          }}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
