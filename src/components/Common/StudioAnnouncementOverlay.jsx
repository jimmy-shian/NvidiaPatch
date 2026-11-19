import React, { useEffect, useState } from 'react';

export const STUDIO_ANNOUNCEMENTS_URL = 'https://home.yesolve-studio.workers.dev/announcements.json';

const KEY_SEEN_IDS = 'yesolve_announcements_seen_ids';
const KEY_DAILY_LAST = 'yesolve_announcements_daily_last';

function localDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseJsonSafe(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isAllowedUrl(raw) {
  if (!raw) return false;
  const trimmed = String(raw).trim().toLowerCase();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

function isEligible(appId, item) {
  if (!item || !item.id || item.enabled === false) return false;
  if (!item.title?.trim() && !item.message?.trim()) return false;

  const targets = Array.isArray(item.apps)
    ? item.apps.map((a) => String(a).trim().toLowerCase())
    : [];
  if (targets.length > 0 && !targets.includes('all') && !targets.includes(appId.toLowerCase())) {
    return false;
  }

  const nowMs = Date.now();
  if (item.start_at?.trim()) {
    const startMs = Date.parse(item.start_at.trim());
    if (!Number.isFinite(startMs) || nowMs < startMs) return false;
  }
  if (item.end_at?.trim()) {
    const endMs = Date.parse(item.end_at.trim());
    if (!Number.isFinite(endMs) || nowMs > endMs) return false;
  }

  const freq = String(item.frequency || 'once').trim().toLowerCase();
  if (freq === 'always') return true;
  if (freq === 'daily') {
    const dailyMap = parseJsonSafe(localStorage.getItem(KEY_DAILY_LAST), {});
    return dailyMap[item.id] !== localDateKey();
  }
  const seenIds = parseJsonSafe(localStorage.getItem(KEY_SEEN_IDS), []);
  return !seenIds.includes(item.id);
}

function markDismissed(item) {
  if (!item?.id) return;
  try {
    const freq = String(item.frequency || 'once').trim().toLowerCase();
    if (freq === 'always') return;
    if (freq === 'daily') {
      const dailyMap = parseJsonSafe(localStorage.getItem(KEY_DAILY_LAST), {});
      dailyMap[item.id] = localDateKey();
      localStorage.setItem(KEY_DAILY_LAST, JSON.stringify(dailyMap));
      return;
    }
    const seenIds = parseJsonSafe(localStorage.getItem(KEY_SEEN_IDS), []);
    if (!seenIds.includes(item.id)) {
      seenIds.push(item.id);
      localStorage.setItem(KEY_SEEN_IDS, JSON.stringify(seenIds));
    }
  } catch {
    // ignore storage failures
  }
}

export default function StudioAnnouncementOverlay({
  appId,
  blocked,
  defaultTag = '官方公告',
  okLabel = '我知道了',
}) {
  const [announcement, setAnnouncement] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    fetch(STUDIO_ANNOUNCEMENTS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const list = Array.isArray(payload?.announcements) ? payload.announcements : [];
        const matched = list.find((item) => isEligible(appId, item)) || null;
        setAnnouncement(matched);
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [appId]);

  if (blocked || !announcement) return null;

  const dismissible = announcement.dismissible !== false;
  const hasCta = Boolean(announcement.cta_text?.trim() && isAllowedUrl(announcement.cta_url));
  const tagText = announcement.tag?.trim() || defaultTag;

  const handleDismiss = () => {
    markDismissed(announcement);
    setAnnouncement(null);
  };

  const handleCta = () => {
    const url = announcement.cta_url?.trim();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    if (dismissible) handleDismiss();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999990,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0b0f17',
        color: '#f8fafc',
        padding:
          'calc(env(safe-area-inset-top, 0px) + 18px) max(20px, env(safe-area-inset-right, 0px)) calc(env(safe-area-inset-bottom, 0px) + 18px) max(20px, env(safe-area-inset-left, 0px))',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '5px 11px',
            borderRadius: 8,
            background: '#0f2922',
            border: '1px solid #1e4d3f',
            color: '#34d399',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {tagText}
        </span>
        {dismissible && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="關閉"
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '1px solid #26324a',
              background: '#141b2b',
              color: '#94a3b8',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 460,
          margin: '0 auto',
          background: '#121826',
          border: '1px solid #233047',
          borderRadius: 18,
          padding: 22,
          boxShadow: '0 20px 48px rgba(0,0,0,0.5)',
        }}
      >
        {announcement.title && (
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, lineHeight: 1.35, color: '#ffffff' }}>
            {announcement.title}
          </h2>
        )}
        {announcement.message && (
          <div
            style={{
              marginTop: 12,
              maxHeight: '42vh',
              overflowY: 'auto',
              fontSize: 15,
              lineHeight: 1.65,
              color: '#cbd5e1',
              whiteSpace: 'pre-wrap',
            }}
          >
            {announcement.message}
          </div>
        )}
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {hasCta && (
            <button
              type="button"
              onClick={handleCta}
              style={{
                width: '100%',
                minHeight: 46,
                borderRadius: 12,
                border: 0,
                background: '#10b981',
                color: '#052e22',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '0 16px',
              }}
            >
              {announcement.cta_text}
            </button>
          )}
          {dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                width: '100%',
                minHeight: 46,
                borderRadius: 12,
                border: hasCta ? '1px solid #334155' : 0,
                background: hasCta ? '#0f172a' : '#10b981',
                color: hasCta ? '#e2e8f0' : '#052e22',
                fontSize: hasCta ? 14 : 15,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '0 16px',
              }}
            >
              {okLabel}
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          textAlign: 'center',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: '#64748b',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        yesolve studio
      </div>
    </div>
  );
}
