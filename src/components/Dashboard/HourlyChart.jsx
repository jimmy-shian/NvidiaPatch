import React from 'react';
import { useTranslation } from 'react-i18next';

export default function HourlyChart({
  hourlyStats,
  hoveredHourlyIndex,
  setHoveredHourlyIndex
}) {
  const { t } = useTranslation();

  return (
    <div className="glass-panel" style={{ padding: '20px', flex: '1', minHeight: '180px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '16px', fontWeight: '700' }}>{t('dashboard.hourlyTraffic')}</span>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>SQLite</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '42px 0 8px', overflow: 'visible' }}>
        {hourlyStats.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', fontSize: '15px' }}>
            {t('dashboard.noData')}
          </div>
        ) : (
          hourlyStats.map((h, i) => {
            const maxRequests = Math.max(...hourlyStats.map(x => x.request_count), 1);
            const barHeightPercent = h.request_count > 0 ? Math.max((h.request_count / maxRequests) * 100, 5) : 0;
            const errorHeightPercent = h.request_count > 0 ? Math.min((h.error_count / h.request_count) * 100, 100) : 0;
            const hourText = h.hour.split(' ')[1];
            const isHovered = hoveredHourlyIndex === i;
            return (
              <div
                key={i}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', minWidth: '28px', position: 'relative' }}
                onMouseEnter={() => setHoveredHourlyIndex(i)}
                onMouseLeave={() => setHoveredHourlyIndex(null)}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '-36px',
                    left: i < 3 ? '0' : (i > hourlyStats.length - 3 ? 'auto' : '50%'),
                    right: i > hourlyStats.length - 3 ? '0' : 'auto',
                    transform: i < 3 || i > hourlyStats.length - 3
                      ? `translateY(${isHovered ? '0' : '6px'})`
                      : `translateX(-50%) translateY(${isHovered ? '0' : '6px'})`,
                    opacity: isHovered ? 1 : 0,
                    pointerEvents: 'none',
                    transition: 'opacity 180ms ease, transform 180ms ease',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '6px 8px',
                    boxShadow: 'var(--card-shadow)',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    zIndex: 5
                  }}
                >
                  {t('dashboard.hourTooltip', { hour: hourText, total: h.request_count, ok: h.success_count, err: h.error_count })}
                </div>
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
                  <div
                    style={{
                      width: '100%',
                      height: `${barHeightPercent}%`,
                      background: 'var(--bar-gradient)',
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms ease, box-shadow 180ms ease, filter 180ms ease',
                      transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                      boxShadow: isHovered ? '0 0 18px var(--glow-active)' : 'none',
                      filter: isHovered ? 'brightness(1.12)' : 'brightness(1)',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'default'
                    }}
                    title={t('dashboard.hourTooltip', { hour: h.hour, total: h.request_count, ok: h.success_count, err: h.error_count })}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        width: '100%',
                        height: `${errorHeightPercent}%`,
                        background: 'var(--bar-error-gradient)',
                        minHeight: h.error_count > 0 ? '2px' : '0',
                        transition: 'height 450ms cubic-bezier(0.22, 1, 0.36, 1)'
                      }}
                    />
                  </div>
                </div>
                <span style={{ fontSize: '11px', color: isHovered ? 'var(--accent-color)' : 'var(--text-muted)', transition: 'color 180ms ease' }}>{hourText}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
