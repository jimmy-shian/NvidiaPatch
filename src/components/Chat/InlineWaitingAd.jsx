import React, { useState, useRef, useEffect } from 'react';
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
/** 原生廣告載入前的預留高度（css px ≈ dp），避免真實廣告填入時下方泡泡跳動 */
const NATIVE_PLACEHOLDER_HEIGHT = 260;

/**
 * 生成等待廣告：長成「助理正在輸入」的訊息卡，以 inline 方式插在
 * 前一則泡泡與生成中助理泡泡之間，跟著對話流捲動，不再懸浮在畫面上。
 *
 * 原生平台：StartupAdPlugin 會把真正的 AdMob 原生進階廣告對齊到廣告槽位置；
 * 對話流會隨串流成長與捲動，因此每次捲動都用 syncNativeAdInSlot 重新對位，
 * 捲出畫面時暫時停播（保留已載入廣告），捲回來再恢復。
 */
export default function InlineWaitingAd({ isStreaming }) {
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';
  const [dismissed, setDismissed] = useState(false);
  const native = isNativeApp();
  /** 原生平台：廣告槽預留高度；載入後以實測卡片高度校正，no-fill 時收回 */
  const [reservedHeight, setReservedHeight] = useState(native ? NATIVE_PLACEHOLDER_HEIGHT : 0);
  const clickTimestampsRef = useRef([]);
  /** 廣告槽：原生平台上由 StartupAdPlugin 在這個位置放真正的 AdMob 原生進階廣告 */
  const adSlotRef = useRef(null);
  const active = isStreaming && !isBypassed && !dismissed;

  // 掛載時請求（units.floating）；開場廣告讓位（startup-ad-hidden）時重新接手。
  // 只依 active 掛載，不因父層重繪重複請求。
  useEffect(() => {
    if (!active || !native) return undefined;
    let alive = true;
    const request = () => {
      const slot = adSlotRef.current;
      if (!alive || !slot || !slot.isConnected) return;
      showNativeAdInSlot(slot, 'floating', true).then((result) => {
        if (!alive) return;
        if (result?.loaded && result?.height) {
          setReservedHeight(result.height);
          // 載入期間使用者可能已捲動：以目前位置即時重新對位一次
          syncNativeAdInSlot(slot);
        } else if (result) {
          // no-fill：收回預留高度，顯示品牌佔位板
          setReservedHeight(0);
        }
      });
    };
    request();
    const offHidden = onNativeAdHidden(request);
    return () => {
      alive = false;
      offHidden();
    };
  }, [active, native]);

  // 卸載／關閉時釋放原生廣告層（宣告在 request effect 之後，卸載時先移除監聽再釋放）
  useEffect(() => {
    if (!active || !native) return undefined;
    return () => hideNativeAdInSlot();
  }, [active, native]);

  // 對話流會隨串流成長與使用者捲動移動：同步原生廣告層位置
  useEffect(() => {
    if (!active || !native) return undefined;
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
  }, [active, native, reservedHeight]);

  if (!active) return null;

  // 後門略過：5 秒內累計 5 次點擊
  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= BACKDOOR_WINDOW);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= BACKDOOR_CLICKS) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      setDismissed(true);
    }
  };

  return (
    <div
      className="flex flex-col my-2 px-1 sm:px-2 w-full items-start"
      style={{ overflowAnchor: 'none' }}
    >
      <div
        onClick={handleBackdoorClick}
        className="w-full max-w-[94%] sm:max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900 text-slate-100 shadow-sm overflow-hidden"
      >
        {/* 訊息標頭（= MessageBubble assistant header） */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] font-medium text-slate-400 select-none">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
          </svg>
          <span className="text-emerald-400 font-semibold">NvidiaPatch AI</span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-slate-500 text-[10px]">SPONSORED</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            生成中
          </span>
        </div>

        {/* 助理氣泡內嵌廣告槽 */}
        <div className="px-2.5 pb-2.5">
          <div
            ref={adSlotRef}
            className="rounded-xl border border-slate-800/80 bg-black/40 p-2.5"
          >
            <AdSenseSlot slotKey="floating" minHeight={reservedHeight || 70} />
          </div>
          <div className="mt-1.5 flex items-center justify-between px-0.5 text-[10px] text-slate-500">
            <span>贊助內容 · 回覆生成完畢後自動收起</span>
            <span className="inline-block w-1.5 h-3 bg-emerald-400 animate-pulse align-middle" />
          </div>
        </div>
      </div>
    </div>
  );
}
