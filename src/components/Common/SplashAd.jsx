import adResetConfig from '../../../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { showNativeAdInSlot, hideNativeAdInSlot, syncNativeAdInSlot } from '../../lib/startup-ad';
import AdSenseSlot from './AdSenseSlot';

/** 統一倒數長度（秒） */
const AD_DURATION = 5;
/** 後門略過：5 秒內累計 5 次點擊 */
const BACKDOOR_WINDOW = 5000;
const BACKDOOR_CLICKS = 5;
/** 符合 Google AdMob Native Advanced 標準比例之廣告預留高度 (含 140dp+ MediaView 與標題/CTA) */
const SPLASH_AD_MIN_HEIGHT = 240;

/**
 * 開場廣告（5秒）：
 * - 單一視覺重心設計，移除混亂模擬對話元素，聚焦品牌識別與標準比例廣告區
 * - 符合 Google AdMob Native Advanced 尺寸比例規範（寬度 >= 240dp、媒體區 >= 140dp）
 */
export default function SplashAd({ onFinish, appName = 'NvidiaPatch AI' }) {
  const { t } = useTranslation();
  if (typeof window !== 'undefined' && adResetConfig.token && localStorage.getItem('yesolve_ad_bypass_reset_token') !== adResetConfig.token) {
    localStorage.setItem('yesolve_ad_bypass', 'false');
    localStorage.setItem('yesolve_ad_bypass_reset_token', adResetConfig.token);
  }
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';

  const [countdown, setCountdown] = useState(AD_DURATION);
  const [slotHeight, setSlotHeight] = useState(SPLASH_AD_MIN_HEIGHT);
  const [adSettled, setAdSettled] = useState(false);
  const clickTimestampsRef = useRef([]);
  /** 廣告槽：原生平台上由 StartupAdPlugin 在這個位置放真正的 AdMob 原生進階廣告 */
  const adSlotRef = useRef(null);

  // 原生平台：待容器完成初次排版後掛載 AdMob 原生進階廣告，並確保尺寸比例精準
  useEffect(() => {
    if (isBypassed) return;
    let alive = true;
    // 最多等待 3 秒讓原生廣告載入，之後即使尚未回填也開始 5 秒倒數
    const waitTimer = setTimeout(() => {
      if (alive) setAdSettled(true);
    }, 3000);
    const raf = requestAnimationFrame(() => {
      const slot = adSlotRef.current;
      if (!alive || !slot) {
        if (alive) setAdSettled(true);
        return;
      }
      showNativeAdInSlot(slot, 'splash', false).then((result) => {
        if (!alive) return;
        setAdSettled(true);
        if (result?.loaded && result?.height) {
          setSlotHeight(Math.max(SPLASH_AD_MIN_HEIGHT, result.height));
          requestAnimationFrame(() => {
            if (alive && adSlotRef.current) {
              syncNativeAdInSlot(adSlotRef.current);
            }
          });
        }
      });
    });
    const onResize = () => {
      if (adSlotRef.current) syncNativeAdInSlot(adSlotRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      clearTimeout(waitTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      hideNativeAdInSlot();
    };
  }, [isBypassed]);

  useEffect(() => {
    if (isBypassed) {
      onFinish();
      return;
    }
    if (!adSettled) return;

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
  }, [onFinish, isBypassed, adSettled]);

  if (isBypassed) return null;

  // 後門略過：5 秒內累計 5 次點擊
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

  const progressPct = ((AD_DURATION - countdown) / AD_DURATION) * 100;

  return (
    <div
      className="fixed inset-0 z-[999999] flex flex-col justify-between bg-[#090d14] text-slate-100 select-none safe-area-top safe-area-bottom px-5 py-6"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. 頂部品牌識別與倒數計時 */}
      <header className="w-full max-w-md mx-auto flex items-center justify-between pt-2">
        <div
          onClick={handleBackdoorClick}
          className="flex items-center gap-2.5 cursor-default"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400 shadow-sm">
            <Bot size={19} />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-white">{appName}</span>
            <span className="text-[11px] text-slate-400">Local-First AI Agent</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
            {countdown}s
          </span>
        </div>
      </header>

      {/* 2. 中央焦點：標準比例原生廣告容器 */}
      <main className="w-full max-w-md mx-auto my-auto py-4 flex flex-col items-center">
        <div
          onClick={handleBackdoorClick}
          className="w-full rounded-2xl border border-slate-800/90 bg-[#111827] shadow-2xl overflow-hidden cursor-default"
        >
          {/* 明確合規的廣告識別標籤列 */}
          <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800/80 bg-slate-950/60">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono font-semibold text-slate-300 tracking-wider uppercase">
                AD
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                {t('ads.sponsored', '贊助內容')}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('ads.autoEnterIn', `${countdown} 秒後進入`, { count: countdown })}
            </span>
          </div>

          {/* 廣告顯示區：依原生廣告比例動態預留完整空間 */}
          <div className="p-3">
            <div
              ref={adSlotRef}
              className="w-full rounded-xl overflow-hidden bg-slate-950/60"
              style={{ minHeight: `${slotHeight}px` }}
            >
              <AdSenseSlot slotKey="splash" minHeight={slotHeight} />
            </div>
          </div>
        </div>
      </main>

      {/* 3. 底部進度條與工作室標誌 */}
      <footer className="w-full max-w-md mx-auto pb-2 space-y-2.5">
        <div className="w-full h-1 rounded-full bg-slate-800/90 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-1000 ease-linear rounded-full"
            style={{ width: `${Math.min(100, Math.max(20, progressPct + 20))}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tracking-wider">
          <span>YESOLVE STUDIO</span>
          <span>{t('ads.preparingEnv', '準備對話環境…')}</span>
        </div>
      </footer>
    </div>
  );
}
