import { Capacitor, registerPlugin } from '@capacitor/core';
import adConfig from '../../admob-config.json';

interface NativeAdPlacementResult {
  loaded: boolean;
  /** 原生廣告卡片實測高度（dp），讓 WebView 廣告槽預留同樣高度 */
  height?: number;
}

interface StartupAdPlugin {
  /**
   * 在指定的畫面位置 (css px = dp) 上放置 AdMob 原生進階廣告卡片。
   * 由 plugin 以原生 NativeAdView 渲染，確保曝光與點擊歸因正確。
   */
  showNativeAt(options: {
    adUnitId: string;
    x: number;
    y: number;
    width: number;
    /** 緊湊卡（對話流內嵌用）：縮小媒體區與內文行數 */
    compact?: boolean;
  }): Promise<NativeAdPlacementResult>;
  /** 重新對位原生廣告層（廣告槽位於對話流內時，會隨串流與捲動移動） */
  moveNativeAt(options: { x: number; y: number; visible: boolean }): Promise<void>;
  hideNative(): Promise<void>;
}

const StartupAd = registerPlugin<StartupAdPlugin>('StartupAd');

type AdUnitKey = keyof typeof adConfig.units & string;

/** 原生廣告層同一時間只有一個 view，記錄目前佔用它的廣告槽元素。 */
let activeSlot: HTMLElement | null = null;

/** 原生廣告層被釋放時廣播的事件，讓其餘可見廣告槽重新接手。 */
const NATIVE_AD_HIDDEN = 'startup-ad-hidden';

/**
 * 監聽原生廣告層被釋放，回傳解除監聽函式。
 * 典型情境：開場 SplashAd 蓋住原生層時，位於下層的 slot 先讓位；
 * Splash 收掉的瞬間會派發事件，此處再依目前可見狀態重新請求。
 */
export function onNativeAdHidden(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(NATIVE_AD_HIDDEN, listener);
  return () => window.removeEventListener(NATIVE_AD_HIDDEN, listener);
}

/**
 * 把真實的 AdMob 原生進階廣告放進設計廣告槽的位置，
 * 讓「你設計的廣告畫面」與「Google 的廣告」合為同一層。
 * adUnitKey 對應 admob-config.json 的 units.*（開場用 splash，其餘位置傳自己的 key）。
 * 回傳載入結果；loaded=true 時附上實測卡片高度（dp）供廣告槽預留空間。
 */
export function showNativeAdInSlot(
  slot: HTMLElement | null,
  adUnitKey: AdUnitKey = 'splash',
  compact = false
): Promise<NativeAdPlacementResult | null> {
  const adUnitId = adConfig.units[adUnitKey];
  if (!Capacitor.isNativePlatform() || !slot || !adUnitId?.startsWith('ca-app-pub-')) {
    return Promise.resolve(null);
  }

  // 原生層只有一個：其他仍連在畫面上的 slot 不搶走，等對方 hide 派發事件時再接手。
  if (activeSlot && activeSlot !== slot && activeSlot.isConnected) {
    return Promise.resolve(null);
  }

  const rect = slot.getBoundingClientRect();
  if (rect.width < 80 || rect.bottom < 0) return Promise.resolve(null);

  activeSlot = slot;
  return StartupAd.showNativeAt({
    adUnitId,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    compact,
  })
    .then((result) => (activeSlot === slot ? result : null))
    .catch((error) => {
      console.warn('[AdMob] native ad was skipped:', error);
      // 請求失敗時僅釋放佔用，不派發事件，避免多個 slot 在錯誤情境下互相觸發重試迴圈。
      if (activeSlot === slot) activeSlot = null;
      return null;
    });
}

/**
 * 對話流內的廣告槽會隨串流成長與捲動移動：
 * 依目前視窗位置重新對位原生廣告層；捲出畫面時暫時停播（INVISIBLE），
 * 保留已載入的廣告，捲回畫面時再由下一次同步恢復顯示。
 */
export function syncNativeAdInSlot(slot: HTMLElement | null): void {
  if (!Capacitor.isNativePlatform() || !slot) return;
  const rect = slot.getBoundingClientRect();
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const visible = rect.width >= 80 && rect.bottom > 0 && rect.top < viewportHeight;
  void StartupAd.moveNativeAt({ x: rect.left, y: rect.top, visible }).catch(() => undefined);
}

/** 廣告槽關閉（倒數結束 / 後門略過）時移除原生廣告層，並派發事件讓其餘可見 slot 接手。 */
export function hideNativeAdInSlot(): void {
  activeSlot = null;
  if (Capacitor.isNativePlatform()) {
    void StartupAd.hideNative().catch(() => undefined);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NATIVE_AD_HIDDEN));
}
