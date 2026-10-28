import React, { useState, useRef } from 'react';

export default function FloatingWaitingAd({ isStreaming }) {
  const isBypassed = typeof window !== 'undefined' && localStorage.getItem('yesolve_ad_bypass') === 'true';
  const [dismissed, setDismissed] = useState(false);
  const clickTimestampsRef = useRef([]);

  if (!isStreaming || isBypassed || dismissed) return null;

  // Secret 5-click backdoor to bypass and hide
  const handleBackdoorClick = () => {
    const now = Date.now();
    clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t <= 3000);
    clickTimestampsRef.current.push(now);

    if (clickTimestampsRef.current.length >= 5) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yesolve_ad_bypass', 'true');
      }
      setDismissed(true);
    }
  };

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-sm pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div 
        onClick={handleBackdoorClick}
        className="bg-[#0E1724]/95 backdrop-blur-md border border-emerald-500/30 rounded-2xl p-3.5 shadow-2xl shadow-emerald-950/50 text-slate-100 font-sans cursor-default"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-semibold text-emerald-300">
              神經網路深度思考生成中...
            </span>
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
            贊助廣告
          </span>
        </div>

        {/* Ad slot with neural styling */}
        <div className="bg-[#080C14]/90 rounded-xl p-2.5 border border-emerald-900/40 flex flex-col items-center justify-center min-h-[90px] text-center">
          <ins
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '70px' }}
            data-ad-client="ca-pub-2415998114933157"
            data-ad-slot="(待補)"
            data-ad-format="auto"
          ></ins>
          <div className="text-[11px] text-emerald-400 font-medium mt-1">
            yesolve studio · 神經運算生態
          </div>
          <div className="text-[10px] text-slate-400">
            多模型推理矩陣同步中，回覆生成完畢後將自動關閉
          </div>
        </div>
      </div>
    </div>
  );
}
