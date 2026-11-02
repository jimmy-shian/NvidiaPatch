import React, { useState, useRef, useEffect } from 'react';
import AdSenseSlot from '../Common/AdSenseSlot';
import { showNativeAdInSlot, hideNativeAdInSlot } from '../../lib/startup-ad';

/** 後門略過：5 秒內累計 5 次點擊 */
const BACKDOOR_WINDOW = 5000;
const BACKDOOR_CLICKS = 5;

/**
 * 等待廣告：長成「助理正在輸入」的訊息卡，
 * 與 ChatView 的訊息流完全同一套視覺，不打斷對話節奏。
 */
export default function FloatingWaitingAd({ isStreaming }) {
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';
  const [dismissed, setDismissed] = useState(false);
  const clickTimestampsRef = useRef([]);
  /** 廣告槽：原生平台上由 StartupAdPlugin 在這個位置放真正的 AdMob 原生進階廣告 */
  const adSlotRef = useRef(null);

  // 掛載時請求（units.floating）、關閉時釋放原生廣告層；不因父層重繪重複請求。
  useEffect(() => {
    if (!isStreaming || isBypassed || dismissed) return;
    showNativeAdInSlot(adSlotRef.current, 'floating');
    return () => hideNativeAdInSlot();
  }, [isStreaming, isBypassed, dismissed]);

  if (!isStreaming || isBypassed || dismissed) return null;

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
    <div className="fixed bottom-24 left-1/2 z-40 w-[92%] max-w-sm -translate-x-1/2 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div
        onClick={handleBackdoorClick}
        className="cursor-default overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl shadow-black/60 backdrop-blur-md"
      >
        {/* 訊息標頭（= MessageBubble assistant header） */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] font-medium text-slate-400">
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
            <AdSenseSlot slotKey="floating" minHeight={70} />
          </div>
          <div className="mt-1.5 flex items-center justify-between px-0.5 text-[10px] text-slate-500">
            <span>多模型推論矩陣同步中，回覆生成完畢後自動關閉</span>
            <span className="inline-block w-1.5 h-3 bg-emerald-400 animate-pulse align-middle" />
          </div>
        </div>
      </div>
    </div>
  );
}
