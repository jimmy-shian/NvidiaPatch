/**
 * Image Processing Utilities for Chat Multimodal Attachments
 * Supports reading image Files/Blobs, Canvas-based resizing/compression, and Base64 encoding.
 */

export async function fileToBase64(file) {
  if (!file) {
    throw new Error('未提供檔案');
  }

  // In browser environments with FileReader
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  // Node.js / test environments fallback
  if (typeof file.arrayBuffer === 'function') {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type || 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
  }

  throw new Error('不支援的檔案讀取環境');
}

/**
 * Compresses an image data URL via HTML Canvas to prevent excessive payload sizes
 * @param {string} dataUrl - Raw image Data URL
 * @param {number} maxDimension - Max width or height in pixels (default 1280)
 * @param {number} quality - JPEG compression quality 0.0 - 1.0 (default 0.8)
 * @returns {Promise<string>} Compressed Data URL
 */
export async function compressImage(dataUrl, maxDimension = 1280, quality = 0.8) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }

  // If SVG or gif animation, do not compress via canvas to preserve animation/vector
  if (dataUrl.startsWith('data:image/svg') || dataUrl.startsWith('data:image/gif')) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Scale down if exceeds maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return resolve(dataUrl);
      }

      ctx.drawImage(img, 0, 0, width, height);
      // Compress to image/jpeg for photos, fallback to original if smaller
      const compressed = canvas.toDataURL('image/jpeg', quality);
      resolve(compressed.length < dataUrl.length ? compressed : dataUrl);
    };

    img.onerror = () => {
      // Fallback to original on loading error
      resolve(dataUrl);
    };

    img.src = dataUrl;
  });
}

/**
 * Complete processor for user-selected or pasted image file
 * @param {File|Blob} file 
 * @returns {Promise<{ id: string, url: string, name: string, size: number, type: string }>}
 */
export async function processImageFile(file) {
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('所選檔案非圖片格式');
  }

  const rawBase64 = await fileToBase64(file);
  const compressedUrl = await compressImage(rawBase64);

  return {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url: compressedUrl,
    name: file.name || 'image.jpg',
    size: compressedUrl.length,
    type: file.type || 'image/jpeg'
  };
}
