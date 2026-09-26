/**
 * Card Share Utility & High-Definition Meihua Card HTML Reconstruction Engine
 * 
 * Generates crystal-clear, non-screenshot high-definition HTML cards for Meihua divination hexagrams.
 * Supports configurable width/height, retina pixel ratios (2x/3x), elegant typography, and direct native/web share.
 */
import { toPng } from 'html-to-image';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

/**
 * Generates an isolated, perfectly styled DOM element representing the Meihua Hexagram card.
 * Strips all interactive UI clutter (toggles, copy buttons, dropdowns) and renders at full specified width.
 * 
 * @param {Object} params
 * @param {Object} params.calc - Deterministic calculation result
 * @param {Object} params.know - Knowledge resolution data
 * @param {number} [params.width=640] - Configurable canvas width in px
 * @param {number|null} [params.height=null] - Optional canvas height in px (null for auto)
 * @returns {HTMLElement} Detached DOM element ready for crisp offscreen rendering
 */
export function buildMeihuaCardElement({ calc = {}, know = {}, width = 640, height = null, customDocument = null } = {}) {
  const doc = customDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    return {
      style: { width: `${width}px`, height: height ? `${height}px` : 'auto' },
      textContent: `${calc.primary?.hexagram?.fullName || ''} ${calc.mutual?.hexagram?.fullName || ''} ${calc.changed?.hexagram?.fullName || ''} 【${calc.tiYong?.relation || ''}】 ${know.primaryHexagram?.judgement || ''} ${know.movingLine?.name || ''} ${know.movingLine?.text || ''} ${calc.randomNumbers?.join(', ') || ''} NvidiaPatch Chat`
    };
  }

  const createEl = (tag) => doc.createElement(tag);
  const container = createEl('div');
  container.className = 'meihua-share-card-container';
  
  // Explicit dimensions to avoid viewport squishing
  container.style.width = `${width}px`;
  if (height) {
    container.style.height = `${height}px`;
  }
  container.style.boxSizing = 'border-box';
  container.style.padding = '24px';
  container.style.borderRadius = '20px';
  container.style.background = 'linear-gradient(145deg, #0e1420 0%, #151122 50%, #1a0f1f 100%)';
  container.style.border = '1px solid rgba(244, 63, 94, 0.45)';
  container.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.7)';
  container.style.color = '#f1f5f9';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang TC", "Microsoft JhengHei", sans-serif';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '18px';

  // 1. Header Row
  const header = createEl('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.borderBottom = '1px solid rgba(244, 63, 94, 0.25)';
  header.style.paddingBottom = '14px';

  const titleBox = createEl('div');
  titleBox.style.display = 'flex';
  titleBox.style.alignItems = 'center';
  titleBox.style.gap = '10px';

  const icon = createEl('span');
  icon.textContent = '🌸';
  icon.style.fontSize = '22px';

  const titleText = createEl('span');
  titleText.textContent = '梅花易數排盤';
  titleText.style.fontSize = '20px';
  titleText.style.fontWeight = '700';
  titleText.style.color = '#fda4af';
  titleText.style.letterSpacing = '0.5px';

  titleBox.appendChild(icon);
  titleBox.appendChild(titleText);

  // Method Badge
  const badge = createEl('div');
  badge.style.display = 'flex';
  badge.style.alignItems = 'center';
  badge.style.gap = '6px';
  badge.style.padding = '4px 12px';
  badge.style.borderRadius = '12px';
  badge.style.background = 'rgba(76, 5, 25, 0.6)';
  badge.style.border = '1px solid rgba(244, 63, 94, 0.5)';
  badge.style.color = '#fecdd3';
  badge.style.fontSize = '12px';
  badge.style.fontWeight = '600';
  badge.style.fontFamily = 'monospace';

  const methodText = calc?.method === 'time'
    ? '⏰ 時間起卦'
    : (calc?.randomNumbers ? `🎲 ${calc.randomNumbers.join(', ')}` : '🔢 數理起卦');
  badge.textContent = methodText;

  header.appendChild(titleBox);
  header.appendChild(badge);
  container.appendChild(header);

  // 2. Three Hexagrams Grid (Primary, Mutual, Changed)
  const hexGrid = createEl('div');
  hexGrid.style.display = 'grid';
  hexGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  hexGrid.style.gap = '12px';

  const createHexCard = ({ label, labelColor, name, upper, lower, footerText, movingLine, borderColor }) => {
    const card = createEl('div');
    card.style.background = 'rgba(15, 23, 42, 0.85)';
    card.style.border = `1px solid ${borderColor}`;
    card.style.borderRadius = '14px';
    card.style.padding = '14px 10px';
    card.style.textAlign = 'center';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '4px';

    const lbl = createEl('div');
    lbl.textContent = label;
    lbl.style.fontSize = '12px';
    lbl.style.fontWeight = '600';
    lbl.style.color = labelColor;

    const hexTitle = createEl('div');
    hexTitle.textContent = name || '—';
    hexTitle.style.fontSize = '18px';
    hexTitle.style.fontWeight = '800';
    hexTitle.style.color = '#ffffff';

    const sub = createEl('div');
    const uName = upper?.name ? `${upper.name}(${upper.element || ''})` : '';
    const lName = lower?.name ? `${lower.name}(${lower.element || ''})` : '';
    sub.textContent = `${uName} / ${lName}`;
    sub.style.fontSize = '12px';
    sub.style.color = '#94a3b8';
    sub.style.fontFamily = 'monospace';

    const foot = createEl('div');
    foot.textContent = movingLine ? `動${movingLine}爻` : footerText;
    foot.style.fontSize = '12px';
    foot.style.fontWeight = movingLine ? '700' : '500';
    foot.style.color = movingLine ? '#fbbf24' : '#64748b';

    card.appendChild(lbl);
    card.appendChild(hexTitle);
    card.appendChild(sub);
    card.appendChild(foot);
    return card;
  };

  hexGrid.appendChild(createHexCard({
    label: '本卦（現狀）',
    labelColor: '#fb7185',
    name: calc.primary?.hexagram?.fullName,
    upper: calc.primary?.upper,
    lower: calc.primary?.lower,
    movingLine: calc.primary?.movingLine,
    borderColor: 'rgba(244, 63, 94, 0.4)'
  }));

  hexGrid.appendChild(createHexCard({
    label: '互卦（過程）',
    labelColor: '#c084fc',
    name: calc.mutual?.hexagram?.fullName,
    upper: calc.mutual?.upper,
    lower: calc.mutual?.lower,
    footerText: '中段內應',
    borderColor: 'rgba(168, 85, 247, 0.4)'
  }));

  hexGrid.appendChild(createHexCard({
    label: '變卦（趨勢）',
    labelColor: '#38bdf8',
    name: calc.changed?.hexagram?.fullName,
    upper: calc.changed?.upper,
    lower: calc.changed?.lower,
    footerText: '後續走向',
    borderColor: 'rgba(56, 189, 248, 0.4)'
  }));

  container.appendChild(hexGrid);

  // 3. Ti-Yong Dynamics
  const tiYongBox = createEl('div');
  tiYongBox.style.background = 'rgba(0, 0, 0, 0.4)';
  tiYongBox.style.border = '1px solid rgba(244, 63, 94, 0.3)';
  tiYongBox.style.borderRadius = '14px';
  tiYongBox.style.padding = '14px 16px';
  tiYongBox.style.display = 'flex';
  tiYongBox.style.flexDirection = 'column';
  tiYongBox.style.gap = '8px';

  const tiYongTop = createEl('div');
  tiYongTop.style.display = 'flex';
  tiYongTop.style.alignItems = 'center';
  tiYongTop.style.justifyContent = 'space-between';

  const tiYongTitle = createEl('span');
  tiYongTitle.textContent = '體用五行生剋';
  tiYongTitle.style.fontSize = '14px';
  tiYongTitle.style.fontWeight = '700';
  tiYongTitle.style.color = '#fda4af';

  const relationBadge = createEl('span');
  relationBadge.textContent = `【${calc.tiYong?.relation || '—'}】`;
  relationBadge.style.fontSize = '13px';
  relationBadge.style.fontWeight = '700';
  relationBadge.style.padding = '2px 10px';
  relationBadge.style.borderRadius = '20px';
  relationBadge.style.background = 'rgba(159, 18, 57, 0.6)';
  relationBadge.style.color = '#ffe4e6';
  relationBadge.style.border = '1px solid rgba(225, 29, 72, 0.6)';

  tiYongTop.appendChild(tiYongTitle);
  tiYongTop.appendChild(relationBadge);
  tiYongBox.appendChild(tiYongTop);

  const tiYongVersus = createEl('div');
  tiYongVersus.style.display = 'flex';
  tiYongVersus.style.alignItems = 'center';
  tiYongVersus.style.justifyContent = 'space-between';
  tiYongVersus.style.fontSize = '13px';
  tiYongVersus.style.color = '#cbd5e1';

  const tiText = know?.ti?.trigram
    ? `體卦【${know.ti.trigram.name} (${know.ti.trigram.element})】`
    : '體卦';
  const yongText = know?.yong?.trigram
    ? `用卦【${know.yong.trigram.name} (${know.yong.trigram.element})】`
    : '用卦';

  const tiSpan = createEl('span');
  tiSpan.textContent = tiText;
  const vsSpan = createEl('span');
  vsSpan.textContent = 'vs';
  vsSpan.style.color = '#64748b';
  vsSpan.style.fontWeight = '600';
  const yongSpan = createEl('span');
  yongSpan.textContent = yongText;

  tiYongVersus.appendChild(tiSpan);
  tiYongVersus.appendChild(vsSpan);
  tiYongVersus.appendChild(yongSpan);
  tiYongBox.appendChild(tiYongVersus);

  if (know?.relationRule) {
    const ruleDesc = createEl('p');
    ruleDesc.style.margin = '0';
    ruleDesc.style.paddingTop = '8px';
    ruleDesc.style.borderTop = '1px solid rgba(51, 65, 85, 0.6)';
    ruleDesc.style.fontSize = '12px';
    ruleDesc.style.color = '#94a3b8';
    ruleDesc.style.lineHeight = '1.6';
    ruleDesc.textContent = `${know.relationRule.nature}：${know.relationRule.summary}（${know.relationRule.guidance}）`;
    tiYongBox.appendChild(ruleDesc);
  }

  container.appendChild(tiYongBox);

  // 4. Hexagram Scriptural Citations
  if (know?.primaryHexagram?.judgement) {
    const scriptureBox = createEl('div');
    scriptureBox.style.background = 'rgba(0, 0, 0, 0.3)';
    scriptureBox.style.border = '1px solid #1e293b';
    scriptureBox.style.borderRadius = '14px';
    scriptureBox.style.padding = '12px 14px';
    scriptureBox.style.fontSize = '12px';
    scriptureBox.style.display = 'flex';
    scriptureBox.style.flexDirection = 'column';
    scriptureBox.style.gap = '6px';

    const scriptureHead = createEl('div');
    scriptureHead.textContent = '周易經文引證：';
    scriptureHead.style.color = '#94a3b8';
    scriptureHead.style.fontWeight = '600';
    scriptureBox.appendChild(scriptureHead);

    const judgeP = createEl('p');
    judgeP.style.margin = '0';
    judgeP.style.color = '#cbd5e1';
    judgeP.textContent = `【卦辭】${know.primaryHexagram.judgement}`;
    scriptureBox.appendChild(judgeP);

    if (know.movingLine) {
      const lineP = createEl('p');
      lineP.style.margin = '0';
      lineP.style.color = '#fde68a';
      lineP.textContent = `【爻辭】${know.movingLine.name}：${know.movingLine.text}`;
      scriptureBox.appendChild(lineP);
    }

    container.appendChild(scriptureBox);
  }

  // 5. Verification Check Mark
  const checkRow = createEl('div');
  checkRow.style.display = 'flex';
  checkRow.style.alignItems = 'center';
  checkRow.style.gap = '6px';
  checkRow.style.fontSize = '12px';
  checkRow.style.color = '#34d399';
  checkRow.style.fontFamily = 'monospace';
  checkRow.innerHTML = '<span>✓</span><span>已完成確定性數理排盤與體用生剋判定，結果已引導大模型生成。</span>';
  container.appendChild(checkRow);

  // 6. Watermark Footer
  const footer = createEl('div');
  footer.style.paddingTop = '10px';
  footer.style.borderTop = '1px solid rgba(244, 63, 94, 0.25)';
  footer.style.display = 'flex';
  footer.style.alignItems = 'center';
  footer.style.justifyContent = 'space-between';
  footer.style.fontSize = '11px';
  footer.style.color = '#64748b';
  footer.style.fontFamily = 'monospace';

  const leftFoot = createEl('span');
  leftFoot.textContent = '🌸 梅花易數排盤 · 傳承邵雍心法';
  const rightFoot = createEl('span');
  rightFoot.textContent = 'NvidiaPatch Chat';
  rightFoot.style.color = '#38bdf8';

  footer.appendChild(leftFoot);
  footer.appendChild(rightFoot);
  container.appendChild(footer);

  return container;
}

/**
 * High-definition HTML-reconstructed Meihua image exporter.
 * Mounts an isolated DOM node off-screen with user-configured width/height, captures via html-to-image with pixelRatio: 3, and invokes native/web share.
 * 
 * @param {Object} options
 * @param {Object} options.calc - Calculation data
 * @param {Object} options.know - Knowledge data
 * @param {number} [options.width=680] - Desired width (e.g. 640, 800, 1080)
 * @param {number|null} [options.height=null] - Desired height (null for auto)
 * @param {string} [options.title='梅花易數排盤']
 * @param {string} [options.fileName='meihua-hexagram.png']
 * @returns {Promise<{ success: boolean, method: string, dataUrl: string }>}
 */
export async function shareMeihuaCardAsImage({
  calc = {},
  know = {},
  width = 680,
  height = null,
  title = '梅花易數排盤',
  fileName = 'meihua-hexagram.png',
  customDocument = null
} = {}) {
  const doc = customDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    return { success: true, method: 'headless_mock', dataUrl: 'data:image/png;base64,mock' };
  }

  // Ensure fonts ready
  if (doc.fonts && doc.fonts.ready) {
    await doc.fonts.ready;
  }

  // 1. Build reconstructed element
  const cardElement = buildMeihuaCardElement({ calc, know, width, height, customDocument: doc });

  // 2. Offscreen rendering stage (positioned off-screen but in DOM so html-to-image can render layout)
  const wrapper = doc.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '-9999px';
  wrapper.style.opacity = '1';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '-9999';
  wrapper.appendChild(cardElement);
  doc.body.appendChild(wrapper);

  let dataUrl = '';
  try {
    dataUrl = await toPng(cardElement, {
      pixelRatio: 3, // High-DPI crisp retina output
      backgroundColor: '#0e1420',
      cacheBust: true
    });
  } finally {
    // Always clean up offscreen wrapper
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }

  // 3. Dispatch to Native Share / Web Share / Download
  if (Capacitor.isNativePlatform()) {
    try {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache
      });

      await Share.share({
        title,
        text: '來自 NvidiaPatch Chat 的梅花易數高清排盤',
        files: [savedFile.uri],
        dialogTitle: '分享梅花高清排盤卡片'
      });
      return { success: true, method: 'native_share', dataUrl };
    } catch (nativeErr) {
      console.warn('[CardShare] Native share failed, falling back:', nativeErr);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title,
          files: [file]
        });
        return { success: true, method: 'web_share', dataUrl };
      }
    } catch (_) {}
  }

  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, method: 'download', dataUrl };
  }

  return { success: false, dataUrl };
}

/**
 * Backward compatible DOM element capture utility
 */
export async function shareCardAsImage(element, { title = '梅花易數排盤', fileName = 'meihua-hexagram.png', pixelRatio = 3 } = {}) {
  if (!element) {
    throw new Error('找不到要分享的排盤卡片元素');
  }

  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const dataUrl = await toPng(element, {
    pixelRatio,
    backgroundColor: '#0e1420',
    cacheBust: true,
    style: {
      borderRadius: '16px',
      margin: '0',
      padding: '16px'
    }
  });

  if (Capacitor.isNativePlatform()) {
    try {
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
      return { success: true, method: 'native_share', dataUrl };
    } catch (nativeErr) {
      console.warn('[CardShare] Native share fallback:', nativeErr);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return { success: true, method: 'web_share', dataUrl };
      }
    } catch (_) {}
  }

  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, method: 'download', dataUrl };
  }

  return { success: false, dataUrl };
}
