import React, { useEffect, useState } from 'react';
import { requestAdFill, useAdSenseSlot } from '../../lib/adsense';

/**
 * 廣告內容載體。
 *
 * 狀態流轉：
 * - 網頁版且 slot id 已設定，且 AdSense script 載入完成 → 渲染 <ins> 並 push() 填充
 * - 載入中 / 原生原生層準備中 → 顯示低對比、柔和過渡的 Skeleton 骨架佔位，避免刺眼邊框與假廣告文字
 * - 失敗或無填充 → 回報父層收合空間，不持續佔用螢幕
 */
export default function AdSenseSlot({
  slotKey,
  minHeight = 100,
  onStateChange,
  showSkeleton = true,
}) {
  const { client, slot, renderable } = useAdSenseSlot(slotKey);
  const [adFailed, setAdFailed] = useState(false);

  // <ins> 動態掛載後進入 AdSense 填充佇列
  useEffect(() => {
    if (renderable) {
      try {
        requestAdFill();
        onStateChange?.('loaded');
      } catch (err) {
        setAdFailed(true);
        onStateChange?.('failed');
      }
    } else {
      onStateChange?.('loading');
    }
  }, [renderable, onStateChange]);

  if (adFailed) {
    return null;
  }

  if (!renderable) {
    if (!showSkeleton) return null;
    return (
      <div
        className="w-full rounded-xl overflow-hidden bg-slate-900/60 p-3 flex flex-col justify-center gap-2.5 transition-all duration-300"
        style={{ minHeight: `${minHeight}px` }}
        aria-hidden="true"
      >
        {/* 低對比柔和 Skeleton 佔位 */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-800/80 animate-pulse shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="w-1/3 h-3 rounded bg-slate-800/80 animate-pulse" />
            <div className="w-2/3 h-2.5 rounded bg-slate-800/50 animate-pulse" />
          </div>
        </div>
        <div className="w-full flex-1 min-h-[44px] rounded-lg bg-slate-800/40 animate-pulse" />
      </div>
    );
  }

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block', width: '100%' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
