import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shareCardAsImage } from '../cardShare';
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
});
