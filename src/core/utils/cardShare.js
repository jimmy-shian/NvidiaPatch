/**
 * Card Share Utility
 * Captures a DOM node to high-res PNG and invokes native share or web download.
 */
import { toPng } from 'html-to-image';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

export async function shareCardAsImage(element, { title = '梅花易數排盤', fileName = 'meihua-hexagram.png' } = {}) {
  if (!element) {
    throw new Error('找不到要分享的排盤卡片元素');
  }

  // Ensure fonts are ready before rendering
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  // Generate PNG data URL
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    backgroundColor: '#0e1420',
    cacheBust: true,
    style: {
      borderRadius: '16px',
      margin: '0',
      padding: '12px'
    }
  });

  if (Capacitor.isNativePlatform()) {
    try {
      // Strip base64 prefix
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache
      });

      await Share.share({
        title,
        text: '來自 NvidiaPatch Chat 的梅花易數排盤分析',
        files: [savedFile.uri],
        dialogTitle: '分享梅花排盤卡片'
      });
      return { success: true, method: 'native_share' };
    } catch (nativeErr) {
      console.warn('[CardShare] Native share failed, falling back:', nativeErr);
    }
  }

  // Web fallback: Web Share API if supported
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title,
          files: [file]
        });
        return { success: true, method: 'web_share' };
      }
    } catch (_) {}
  }

  // Ultimate fallback: direct download
  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, method: 'download' };
  }

  return { success: false };
}
