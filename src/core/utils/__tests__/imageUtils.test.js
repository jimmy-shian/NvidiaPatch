import { describe, it, expect } from 'vitest';
import { fileToBase64, compressImage, processImageFile } from '../imageUtils';

describe('imageUtils', () => {
  it('rejects fileToBase64 when file is null or undefined', async () => {
    await expect(fileToBase64(null)).rejects.toThrow('未提供檔案');
  });

  it('converts a Blob or File to Base64 data URL', async () => {
    const fakeBlob = new Blob(['hello world'], { type: 'image/png' });
    const result = await fileToBase64(fakeBlob);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('preserves SVG and GIF data URLs without canvas compression', async () => {
    const svgData = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const result = await compressImage(svgData);
    expect(result).toBe(svgData);

    const gifData = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const gifResult = await compressImage(gifData);
    expect(gifResult).toBe(gifData);
  });

  it('rejects non-image files in processImageFile', async () => {
    const textBlob = new Blob(['test content'], { type: 'text/plain' });
    textBlob.name = 'test.txt';
    await expect(processImageFile(textBlob)).rejects.toThrow('所選檔案非圖片格式');
  });

  it('processes image file into structured object', async () => {
    const pngBlob = new Blob(['fake image bytes'], { type: 'image/png' });
    pngBlob.name = 'avatar.png';

    const processed = await processImageFile(pngBlob);
    expect(processed).toHaveProperty('id');
    expect(processed.id).toMatch(/^img_/);
    expect(processed).toHaveProperty('url');
    expect(processed.name).toBe('avatar.png');
    expect(processed.type).toBe('image/png');
    expect(typeof processed.size).toBe('number');
  });
});
