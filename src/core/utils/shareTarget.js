/**
 * Android Share Target Helper
 * Reads pending shared text from native Android NativeStreamBridge.
 */
export function checkPendingSharedText() {
  if (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.getPendingSharedText === 'function') {
    try {
      const text = window.NativeStreamBridge.getPendingSharedText();
      if (text && typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    } catch (e) {
      console.warn('[ShareTarget] Failed to get pending shared text:', e);
    }
  }
  return null;
}
