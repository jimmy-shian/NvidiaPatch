import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import adsenseConfig from '../../adsense-config.json';

const config = adsenseConfig;

/** AdSense script 載入逾時（毫秒）→ 逾時後改顯示品牌佔位板。 */
const ADSENSE_LOAD_TIMEOUT = 8000;

/**
 * 原生平台一律走 AdMob 原生 SDK（App Open Ad / Banner / Interstitial）。
 * WebView 內的 AdSense 顯示廣告既不會 fill，也違反 AdSense 對嵌入環境的要求，
 * 因此原生平台一律不渲染 <ins>。
 */
export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getAdSlot(key) {
  return (config.slots?.[key] ?? '').trim();
}

/**
 * 只有在「非原生平台 + 已填 publisher client + 已填 slot id」三者皆成立時才渲染 <ins>。
 * 任一條件不成立時改顯示品牌佔位板，避免出現永遠空白的廣告框。
 */
export function canRenderAdSense(key) {
  if (isNativeApp()) return false;
  const client = (config.client ?? '').trim();
  return client.length > 0 && getAdSlot(key).length > 0;
}

let scriptPromise = null;

/** 單例注入 AdSense script；重複呼叫只會載入一次。 */
export function loadAdSenseScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('AdSense requires a browser environment'));
      return;
    }
    const existing = document.querySelector('script[data-adsense-loader]');
    if (existing) {
      if (window.adsbygoogle) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('AdSense script failed to load')));
      return;
    }
    const client = (config.client ?? '').trim();
    if (!client) {
      reject(new Error('adsense-config.json is missing client'));
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.adsenseLoader = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('AdSense script failed to load'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** AdSense script 就緒後呼叫一次，讓 <ins> 進入填充佇列。 */
export function requestAdFill() {
  try {
    if (!window.adsbygoogle) return;
    window.adsbygoogle.push({});
  } catch (error) {
    console.warn('[AdSense] push failed:', error);
  }
}

/**
 * 掛載 AdSense script 並回傳目前廣告槽狀態。
 * status: 'none' = 原生平台或未設定 slot；'loading' = script 載入中；
 *         'ready' = script 已就緒；'error' = script 載入失敗或逾時。
 * renderable 為 true 時才允許渲染 <ins>，其餘一律改顯示品牌佔位板，避免空白死框。
 */
export function useAdSenseSlot(key) {
  const supported = canRenderAdSense(key);
  const [status, setStatus] = useState(supported ? 'loading' : 'none');

  useEffect(() => {
    if (!supported) {
      setStatus('none');
      return;
    }
    let cancelled = false;
    setStatus('loading');

    const timeout = setTimeout(() => {
      if (!cancelled) setStatus('error');
    }, ADSENSE_LOAD_TIMEOUT);

    loadAdSenseScript()
      .then(() => {
        if (cancelled) return;
        clearTimeout(timeout);
        setStatus('ready');
      })
      .catch((error) => {
        console.warn('[AdSense] script load failed:', error);
        if (cancelled) return;
        clearTimeout(timeout);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [supported, key]);

  return {
    status,
    client: supported ? (config.client ?? '').trim() : '',
    slot: supported ? getAdSlot(key) : '',
    renderable: status === 'ready',
  };
}
