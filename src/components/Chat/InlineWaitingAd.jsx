import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import AdSenseSlot from '../Common/AdSenseSlot';
import { isNativeApp } from '../../lib/adsense';
import {
  showNativeAdInSlot,
  hideNativeAdInSlot,
  syncNativeAdInSlot,
  onNativeAdHidden
} from '../../lib/startup-ad';

/** 後門略過：5 秒內累計 5 次點擊 */
const BACKDOOR_WINDOW = 5000;
const BACKDOOR_CLICKS = 5;

/** 預設廣告載入中預留高度 (匹配 compact 原生卡含 132dp+ MediaView + 標題 + 按鈕之實測 ~285dp 尺寸) */
const INITIAL_PLACEHOLDER_HEIGHT = 285;

/**
 * 收起前的緩衝時間：廣告只在「最終完成」後收起。
 * 中間的搜尋／思考階段即使串流短暫換輪次，也不會立即關閉廣告。
 */
const AD_CLOSE_GRACE_MS = 800;

/**
 * 對話等待廣告（N-AD01, N-AD02）：
 * - 只有在使用者發問生成期間展示，回覆「最終完成」時才消失
 * - 不在思考完、工具搜尋完或中間輪次提前消失
 * - 支援 AdMob 原生廣告與 Web 贊助卡槽，確保符合 AdMob 120dp+ 最小媒體尺寸比例
 * - 獨立狀態，不干擾對話捲動
 */
export default function InlineWaitingAd({ isStreaming }) {
  const { t } = useTranslation();
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';
  const [adStatus, setAdStatus] = useState(() => (isStreaming && !isBypassed ? 'loading' : 'idle')); // idle | loading | loaded | manual_closed
  const [shouldRender, setShouldRender] = useState(() => Boolean(isStreaming && !isBypassed));
  const native = isNativeApp();
  const [reservedHeight, setReservedHeight] = useState(INITIAL_PLACEHOLDER_HEIGHT);
  const clickTimestampsRef = useRef([]);
  const adSlotRef = useRef(null);
  const manualClosedForStreamRef = useRef(false);

  // 1. 生命週期：只要 isStreaming 為 true，廣告卡片必須持續展示直到「最終完成」
  useEffect(() => {
    if (isStreaming) {
      if (!isBypassed && !manualClosedForStreamRef.current) {
        setShouldRender(true);
        setAdStatus((prev) => (prev === 'idle' ? 'loading' : prev));
        requestAnimationFrame(() => {
          adSlotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return undefined;
    }

    // 串流結束（最終完成／中斷）：緩衝後平滑收起，並重置手動關閉標記供下次對話使用
    manualClosedForStreamRef.current = false;
    if (shouldRender) {
      const closeTimer = setTimeout(() => {
        setShouldRender(false);
        setAdStatus('idle');
      }, AD_CLOSE_GRACE_MS);
      return () => clearTimeout(closeTimer);
    }
  }, [isStreaming, isBypassed, shouldRender]);

  // 2. 原生廣告載入處理（待 DOM 排版完成後量測槽位寬高再請求 AdMob）
  useEffect(() => {
    if (!shouldRender || !native || adStatus !== 'loading') return undefined;
    let alive = true;
    let inFlight = false;
    let rafId = 0;
    const request = () => {
      const slot = adSlotRef.current;
      if (!alive || !slot || !slot.isConnected || inFlight) return;
      inFlight = true;
      showNativeAdInSlot(slot, 'floating', true).then((result) => {
        if (!alive) return;
        if (result?.loaded && result?.height) {
          setAdStatus('loaded');
          setReservedHeight(Math.max(INITIAL_PLACEHOLDER_HEIGHT, result.height));
          requestAnimationFrame(() => {
            if (alive && slot?.isConnected) {
              syncNativeAdInSlot(slot);
            }
          });
        } else {
          inFlight = false;
          // 若無填充或載入中，維持展示符合比例的贊助骨架卡，不提早消失
          setReservedHeight(INITIAL_PLACEHOLDER_HEIGHT);
        }
      }).catch(() => {
        if (alive) {
          inFlight = false;
          setReservedHeight(INITIAL_PLACEHOLDER_HEIGHT);
        }
      });
    };

    rafId = requestAnimationFrame(request);
    const offHidden = onNativeAdHidden(request);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      offHidden();
    };
  }, [shouldRender, native, adStatus]);

  // 3. 卸載時隱藏廣告層
  useEffect(() => {
    if (!shouldRender || !native) return undefined;
    return () => hideNativeAdInSlot();
  }, [shouldRender, native]);

  // 4. 對話捲動時同步原生廣告位置
  useEffect(() => {
    if (!shouldRender || !native || adStatus !== 'loaded') return undefined;
    const slot = adSlotRef.current;
    if (!slot) return undefined;
    let raf = 0;
    let lastKey = '';
    const sync = () => {
      raf = 0;
      if (!slot.isConnected) return;
      const rect = slot.getBoundingClientRect();
      const key = `${Math.round(rect.left)}:${Math.round(rect.top)}`;
      if (key === lastKey) return;
      lastKey = key;
      syncNativeAdInSlot(slot);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    const scroller = slot.closest('.chat-scroll-container');
    scroller?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(slot);
    sync();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [shouldRender, native, adStatus]);

  // Web 端 AdSense 狀態同步
  const handleAdSenseState = useCallback((state) => {
    if (state === 'loaded') {
      setAdStatus('loaded');
    }
  }, []);

  // 使用者手動關閉
  const handleClose = () => {
    manualClosedForStreamRef.current = true;
    setAdStatus('manual_closed');
    setShouldRender(false);
    hideNativeAdInSlot();
  };

  // 後門快速略過
  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= BACKDOOR_WINDOW);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= BACKDOOR_CLICKS) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      handleClose();
    }
  };

  if (!shouldRender || adStatus === 'manual_closed' || isBypassed) {
    return null;
  }

  return (
    <div
      className="flex flex-col my-2 px-1 sm:px-2 w-full items-start transition-opacity duration-300 animate-fade-in"
      style={{ overflowAnchor: 'none' }}
    >
      <div className="w-full max-w-[94%] sm:max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-800/80 bg-slate-900/90 text-slate-100 shadow-md overflow-hidden">
        {/* A. 標題區 */}
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1 text-[11px] font-medium text-slate-400 select-none">
          <div
            onClick={handleBackdoorClick}
            className="flex items-center gap-1.5 cursor-default"
          >
            <span className="text-emerald-400">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
              </svg>
            </span>
            <span className="text-slate-300 font-semibold">NvidiaPatch AI</span>
            <span className="text-slate-600">·</span>
            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[9px] uppercase tracking-wider">
              {t('ads.sponsored', '贊助內容')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-mono">
              {adStatus === 'loaded' ? t('ads.sponsorSupport', '贊助支持') : t('ads.generating', '生成中…')}
            </span>
          </div>
        </div>

        {/* B. 廣告內容區 */}
        <div className="px-2.5 pb-2">
          <div
            ref={adSlotRef}
            className="rounded-xl overflow-hidden bg-black/20"
            style={{ minHeight: `${reservedHeight || INITIAL_PLACEHOLDER_HEIGHT}px` }}
          >
            <AdSenseSlot
              slotKey="floating"
              minHeight={reservedHeight || INITIAL_PLACEHOLDER_HEIGHT}
              onStateChange={handleAdSenseState}
            />
          </div>
        </div>

        {/* C. 狀態資訊區 */}
        <div className="px-3 pb-2 flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800/40 pt-1.5">
          <span>{t('ads.autoCollapseHint', '回覆完成後自動收起')}</span>
          <span className="inline-block w-1.5 h-2.5 bg-emerald-400/80 animate-pulse rounded-full" />
        </div>
      </div>
    </div>
  );
}
