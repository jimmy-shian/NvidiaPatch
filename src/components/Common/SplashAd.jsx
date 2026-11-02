import adResetConfig from '../../../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { showNativeAdInSlot, hideNativeAdInSlot } from '../../lib/startup-ad';
import AdSenseSlot from './AdSenseSlot';

/** 統一倒數長度（秒） */
const AD_DURATION = 5;
/** 後門略過：5 秒內累計 5 次點擊 */
const BACKDOOR_WINDOW = 5000;
const BACKDOOR_CLICKS = 5;

/** Bot 圖示（與 MessageBubble 同款線性風格） */
function BotIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
}

/** Brain 圖示（與 ThinkingBlock 同款） */
function BrainIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z" />
    </svg>
  );
}

/**
 * 開場廣告：直接長成 NvidiaPatch 的一段對話。
 * 使用者氣泡 → 深度思考區塊 → 助理訊息（廣告即助理回覆的內容）。
 * 全部採用 ChatView / MessageBubble / ThinkingBlock 的 class 語言。
 */
export default function SplashAd({ onFinish, appName = 'NvidiaPatch AI' }) {
  if (typeof window !== 'undefined' && adResetConfig.token && localStorage.getItem('yesolve_ad_bypass_reset_token') !== adResetConfig.token) {
    localStorage.setItem('yesolve_ad_bypass', 'false');
    localStorage.setItem('yesolve_ad_bypass_reset_token', adResetConfig.token);
  }
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';

  const [countdown, setCountdown] = useState(AD_DURATION);
  const clickTimestampsRef = useRef([]);
  /** 廣告槽：原生平台上由 StartupAdPlugin 在這個位置放真正的 AdMob 原生進階廣告 */
  const adSlotRef = useRef(null);

  // 原生平台：廣告槽位置由 StartupAdPlugin 放真正的 AdMob 原生進階廣告。
  // 只在略過狀態變更時掛載／卸載，不隨父層重繪重新請求廣告。
  useEffect(() => {
    if (isBypassed) return;
    showNativeAdInSlot(adSlotRef.current);
    return () => hideNativeAdInSlot();
  }, [isBypassed]);

  useEffect(() => {
    if (isBypassed) {
      onFinish();
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onFinish, isBypassed]);

  if (isBypassed) return null;

  // 後門略過：5 秒內累計 5 次點擊（訊息標頭 / 助理氣泡）
  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= BACKDOOR_WINDOW);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= BACKDOOR_CLICKS) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      onFinish();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[999999] flex flex-col bg-[#0b0f17] text-slate-100 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 對話流 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4">
        <div className="mx-auto w-full max-w-2xl flex flex-col">

          {/* 使用者訊息（= MessageBubble isUser 樣式） */}
          <div className="flex flex-col my-2 px-1 w-full items-end">
            <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium text-slate-400">
              <span className="font-mono text-slate-500 text-[10px]">00:00</span>
              <span className="text-slate-600">·</span>
              <span>您</span>
            </div>
            <div className="max-w-[94%] rounded-2xl p-3 shadow-sm text-sm break-words bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-br-sm">
              幫我推薦一套本地推理的加速方案
            </div>
          </div>

          {/* 深度思考區塊（= ThinkingBlock 樣式） */}
          <div className="my-2 rounded-2xl border border-slate-800/90 bg-slate-950/80 overflow-hidden backdrop-blur-md shadow-sm">
            <div className="w-full flex items-center justify-between px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <BrainIcon size={14} />
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  深度思考中
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400">贊助內容</span>
            </div>
            <div className="px-3.5 pb-3 pt-1.5 border-t border-slate-800/60 text-xs text-slate-300 bg-black/40 leading-relaxed">
              正在比對本地推理矩陣的吞吐與延遲…
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-emerald-400 animate-pulse align-middle" />
            </div>
          </div>

          {/* 助理訊息：廣告即助理回覆（= MessageBubble assistant 樣式） */}
          <div className="flex flex-col my-2 px-1 w-full items-start">
            <div
              onClick={handleBackdoorClick}
              className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium text-slate-400 cursor-default"
            >
              <span className="text-emerald-400"><BotIcon size={13} /></span>
              <span className="text-emerald-400 font-semibold">{appName}</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-500 text-[10px]">SPONSORED</span>
            </div>

            <div
              onClick={handleBackdoorClick}
              className="w-full max-w-[94%] rounded-2xl p-3 sm:p-3.5 shadow-sm text-sm break-words bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-sm cursor-default"
            >
              {/* 廣告槽：直接嵌在助理訊息本體內 */}
              <div ref={adSlotRef}>
                <AdSenseSlot slotKey="splash" />
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span>由 Google 贊助託播</span>
                <span className="font-mono text-slate-500">剩餘 {countdown}s</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 輸入列（= ChatView 的 composer） */}
      <div className="shrink-0 border-t border-slate-800 bg-[#0b0f17] px-3 py-3">
        <div className="mx-auto w-full max-w-2xl flex items-center gap-2">
          <div className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/80 px-3.5 py-2.5 text-[13px] text-slate-500">
            回覆生成完畢後自動關閉…
          </div>
          <div className="shrink-0 rounded-2xl bg-emerald-600/40 border border-emerald-700/50 px-3.5 py-2.5 text-emerald-300 text-[13px] font-semibold">
            送出
          </div>
        </div>
        <div className="mx-auto mt-2 w-full max-w-2xl text-center text-[10px] tracking-[0.18em] text-slate-600">
          YESOLVE STUDIO
        </div>
      </div>
    </div>
  );
}
