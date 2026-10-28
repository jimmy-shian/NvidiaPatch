import adResetConfig from '../../../ad-reset-config.json';
import React, { useState, useEffect, useRef } from 'react';
import { showStartupAppOpenAd } from '../../lib/startup-ad';

export default function SplashAd({ onFinish, appName = "NvidiaPatch AI" }) {
  if (typeof window !== 'undefined' && adResetConfig.token && localStorage.getItem('yesolve_ad_bypass_reset_token') !== adResetConfig.token) {
    localStorage.setItem('yesolve_ad_bypass', 'false');
    localStorage.setItem('yesolve_ad_bypass_reset_token', adResetConfig.token);
  }
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';

  const [countdown, setCountdown] = useState(5);
  const clickTimestampsRef = useRef([]);

  useEffect(() => {
    if (isBypassed) {
      onFinish();
      return;
    }

    showStartupAppOpenAd();

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

  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= 3000);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= 5) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      onFinish();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[999999] pointer-events-auto bg-[#080C14] text-slate-200 flex flex-col justify-between p-6 select-none font-sans"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Terminal Status Header */}
      <div className="flex items-center justify-between w-full max-w-md mx-auto">
        <div 
          onClick={handleBackdoorClick}
          className="flex items-center space-x-2.5 cursor-default select-none active:opacity-90"
        >
          <div className="w-6 h-6 rounded bg-[#0E1726] border border-emerald-900/60 flex items-center justify-center text-emerald-400 font-mono text-xs font-semibold">
            &gt;_
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-100 font-mono tracking-tight">{appName}</div>
            <div className="text-[10px] text-emerald-500/80 font-mono">CONTEXT_BUFFER_ONLINE</div>
          </div>
        </div>

        <div className="px-2.5 py-1 rounded bg-[#0E1726] border border-slate-800 text-[11px] font-mono text-slate-400">
          {countdown > 0 ? `0${countdown}s` : 'DISPATCH ›'}
        </div>
      </div>

      {/* Center: Clean Context Buffer & Model Matrix Terminal */}
      <div 
        onClick={handleBackdoorClick}
        className="w-full max-w-md mx-auto my-auto bg-[#0C121D] border border-slate-800/90 rounded-lg p-5 cursor-default font-mono"
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs mb-3.5">
          <div className="flex items-center space-x-2 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>SYS.BUFFER_DISPATCH</span>
          </div>
          <span className="text-[10px] text-slate-500">SPONSORED</span>
        </div>

        {/* AdSense ins wrapper */}
        <div className="w-full bg-[#080C14] rounded border border-slate-800/80 p-2 mb-3.5 overflow-hidden">
          <ins
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '120px' }}
            data-ad-client="ca-pub-2415998114933157"
            data-ad-slot="(待補)"
            data-ad-format="auto"
            data-full-width-responsive="true"
          ></ins>
        </div>

        {/* Model Pipeline Parameters */}
        <div className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between p-2 rounded bg-[#080C14] border border-slate-800/60">
            <span className="text-slate-400">TOKEN_WINDOW</span>
            <span className="text-emerald-400">128 / 32,768 [0.4%]</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-[#080C14] border border-slate-800/60">
            <span className="text-slate-400">INFERENCE_RUNTIME</span>
            <span className="text-slate-300">STREAMING_ACTIVE</span>
          </div>
        </div>

        <div className="mt-3.5 pt-2.5 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500">
          <span>ON-DEVICE SESSION PRIVACY</span>
          <span>AD · 5677764204</span>
        </div>
      </div>

      {/* Bottom Signature */}
      <div className="w-full max-w-md mx-auto text-center font-mono">
        <span className="text-[11px] text-slate-600">yesolve studio</span>
      </div>
    </div>
  );
}
