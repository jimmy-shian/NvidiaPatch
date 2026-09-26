import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shareCardAsImage, shareMeihuaCardAsImage, buildMeihuaCardElement } from '../cardShare';
import { toPng } from 'html-to-image';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

vi.mock('html-to-image', () => ({
  toPng: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true
  }
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn().mockResolvedValue({ uri: 'file:///cache/meihua.png' })
  },
  Directory: { Cache: 'CACHE' }
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn().mockResolvedValue({})
  }
}));

describe('Card Share Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws error when element is not provided', async () => {
    await expect(shareCardAsImage(null)).rejects.toThrow('找不到要分享的排盤卡片元素');
  });

  it('exports element to PNG and invokes native share on native platform', async () => {
    const mockElement = {};
    const res = await shareCardAsImage(mockElement, {
      title: '乾為天 · 梅花排盤',
      fileName: 'test-card.png'
    });

    expect(toPng).toHaveBeenCalled();
    expect(Filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'test-card.png',
        directory: 'CACHE'
      })
    );
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '乾為天 · 梅花排盤',
        files: ['file:///cache/meihua.png']
      })
    );
    expect(res.success).toBe(true);
    expect(res.method).toBe('native_share');
  });

  it('buildMeihuaCardElement generates clean HTML with custom width and no interactive buttons', () => {
    const calc = {
      method: 'numbers',
      randomNumbers: [346, 503, 81],
      primary: { hexagram: { fullName: '澤天夬' }, upper: { name: '兌', element: '金' }, lower: { name: '乾', element: '金' }, movingLine: 4 },
      mutual: { hexagram: { fullName: '乾為天' }, upper: { name: '乾', element: '金' }, lower: { name: '乾', element: '金' } },
      changed: { hexagram: { fullName: '水天需' }, upper: { name: '坎', element: '水' }, lower: { name: '乾', element: '金' } },
      tiYong: { relation: '比和' }
    };
    const know = {
      ti: { trigram: { name: '乾', element: '金' } },
      yong: { trigram: { name: '兌', element: '金' } },
      relationRule: { nature: '吉', summary: '比和同道', guidance: '平穩可成' },
      primaryHexagram: { judgement: '揚于王庭' },
      movingLine: { name: '九四', text: '臀无膚' }
    };

    const element = buildMeihuaCardElement({ calc, know, width: 800 });
    expect(element).toBeDefined();
    expect(element.style.width).toBe('800px');
    expect(element.textContent).toContain('澤天夬');
    expect(element.textContent).toContain('乾為天');
    expect(element.textContent).toContain('水天需');
    expect(element.textContent).toContain('【比和】');
    expect(element.textContent).toContain('揚于王庭');
    expect(element.textContent).toContain('九四');
    expect(element.textContent).toContain('346, 503, 81');
    expect(element.textContent).toContain('NvidiaPatch Chat');
  });

  it('shareMeihuaCardAsImage reconstructs card and exports at specified width', async () => {
    const mockDoc = {
      createElement: () => {
        const el = {
          style: {},
          appendChild: () => {},
          parentNode: null
        };
        el.parentNode = { removeChild: () => {} };
        return el;
      },
      body: {
        appendChild: () => {}
      }
    };
    const res = await shareMeihuaCardAsImage({
      calc: { primary: { hexagram: { fullName: '乾為天' } } },
      width: 1080,
      customDocument: mockDoc
    });
    expect(res.success).toBe(true);
    expect(toPng).toHaveBeenCalled();
  });
});
