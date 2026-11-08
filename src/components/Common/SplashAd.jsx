import adResetConfig from '../../../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { Menu, Settings, Bot, User, Brain, Loader2, ChevronDown, Sparkles, Send } from 'lucide-react';
import { showNativeAdInSlot, hideNativeAdInSlot } from '../../lib/startup-ad';
import AdSenseSlot from './AdSenseSlot';

/** 統一倒數長度（秒） */
const AD_DURATION = 5;
/** 後門略過：5 秒內累計 5 次點擊 */
const BACKDOOR_WINDOW = 5000;
const BACKDOOR_CLICKS = 5;

/**
 * 開場廣告（5秒）：
 * - 嚴格遵循 APP 內部介面設計系統（Lucide 圖示、色系、狀態列排版）
 * - 具備安全的頂部導覽列（safe-area-top），避免被系統狀態列或瀏海遮擋
 * - 思考元素使用與 ThinkingBlock 完全一致的 Brain 與 Loader2 旋轉動畫，不再自創元素
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

  // 原生平台：廣告槽位置由 StartupAdPlugin 放真正的 AdMob 原生進階廣告
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

  return (
    <div
      className="fixed inset-0 z-[999999] flex flex-col bg-[#0b0f17] text-slate-100 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. 頂部真實導覽列（含 safe-area-top 防止被手機狀態列／瀏海遮擋） */}
      <header className="flex items-center justify-between px-3 py-2 bg-[#0e1420]/95 border-b border-slate-800/80 backdrop-blur-md z-10 safe-area-top shrink-0">
        <div className="p-2 rounded-xl text-slate-400">
          <Menu size={19} />
        </div>

        {/* 模型選擇器膠囊 */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/90 border border-slate-700/70 shadow-sm max-w-[55%]">
          <Bot size={14} className="text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200 truncate">{appName}</span>
          <ChevronDown size={13} className="text-slate-400 shrink-0" />
        </div>

        <div className="p-2 rounded-xl text-slate-400">
          <Settings size={19} />
        </div>
      </header>

      {/* 2. 對話流區域（與主畫面 MessageBubble 佈局一致） */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 flex flex-col justify-end space-y-3">
        <div className="mx-auto w-full max-w-2xl flex flex-col space-y-3">

          {/* 使用者訊息氣泡 */}
          <div className="flex flex-col my-1 px-1 w-full items-end">
            <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium text-slate-400 select-none">
              <span className="font-mono text-slate-500 text-[10px]">剛剛</span>
              <span className="text-slate-600">·</span>
              <span>您</span>
              <User size={12} className="text-slate-400" />
            </div>
            <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-br-sm p-3 sm:p-3.5 shadow-sm text-sm break-words bg-gradient-to-br from-emerald-600 to-teal-700 text-white">
              幫我推薦一套本地推理的加速方案
            </div>
          </div>

          {/* 思考中區塊（完全遵循 ThinkingBlock 元件設計語言） */}
          <div className="my-1 rounded-2xl border border-slate-800/90 bg-slate-950/80 overflow-hidden backdrop-blur-md shadow-sm">
            <div className="w-full flex items-center justify-between px-3.5 py-2.5 text-left">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Brain size={14} className="text-emerald-400 shrink-0" />
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Loader2 size={12} className="animate-spin text-emerald-400 shrink-0" />
                  <span>正在分析問題脈絡與邏輯推理中…</span>
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <span>展開記錄</span>
                <ChevronDown size={13} />
              </div>
            </div>
            <div className="px-3.5 pb-2.5 pt-1 border-t border-slate-800/60 text-xs text-slate-300 bg-black/40 leading-relaxed font-sans">
              <div className="flex items-center gap-2 text-slate-300 py-0.5 text-xs">
                <span>正在分析本地推理矩陣吞吐量與延遲，並比對最佳配置…</span>
                <span className="inline-block w-1.5 h-3.5 ml-1 bg-emerald-400 animate-pulse align-middle" />
              </div>
            </div>
          </div>

          {/* 贊助內容卡片 */}
          <div className="flex flex-col my-1 px-1 w-full items-start">
            {/* 標題列 */}
            <div
              onClick={handleBackdoorClick}
              className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium text-slate-400 select-none cursor-default"
            >
              <Bot size={13} className="text-emerald-400 shrink-0" />
              <span className="text-emerald-400 font-semibold">{appName}</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-500 text-[10px]">SPONSORED</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                贊助支持
              </span>
            </div>

            {/* 廣告卡片主體 */}
            <div
              onClick={handleBackdoorClick}
              className="w-full max-w-[94%] sm:max-w-[85%] rounded-2xl rounded-bl-sm p-3 sm:p-3.5 border border-slate-800/90 bg-slate-900/95 text-slate-100 shadow-lg cursor-default flex flex-col gap-2.5"
            >
              {/* 廣告槽 */}
              <div ref={adSlotRef} className="w-full overflow-hidden rounded-xl">
                <AdSenseSlot slotKey="splash" minHeight={120} />
              </div>

              {/* 底部說明與倒數 */}
              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                <span className="text-slate-400 text-xs">贊助內容 · 感謝支持開發</span>
                <span className="font-mono text-emerald-400 font-bold bg-emerald-950/70 border border-emerald-800/50 px-2 py-0.5 rounded-md">
                  {countdown}s 後進入
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 3. 底部真實輸入列排版（含 safe-area-bottom） */}
      <div className="shrink-0 border-t border-slate-800/90 bg-[#0b0f17] px-3 py-2.5 safe-area-bottom">
        <div className="mx-auto w-full max-w-2xl flex items-center gap-2">
          <div className="flex-1 rounded-2xl border border-slate-700/60 bg-slate-900/90 px-3.5 py-2.5 text-xs text-slate-500 flex items-center justify-between">
            <span>請輸入訊息…</span>
            <span className="text-[10px] text-slate-600 font-mono">5s 自動進入</span>
          </div>
          <div className="shrink-0 p-2.5 rounded-2xl bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 flex items-center justify-center">
            <Send size={15} />
          </div>
        </div>
      </div>
    </div>
  );
}
