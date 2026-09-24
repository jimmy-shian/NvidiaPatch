/**
 * Vision Fallback & Repackaging Handler
 * Handles reactive retry when upstream model rejects images/multimodal inputs.
 * Strips image_url payloads, repackages messages with explanatory notice, and lets the model decide how to respond.
 */

/**
 * Check whether a message list contains any image inputs (OpenAI image_url parts or images array)
 * @param {Array<Object>} messages
 * @returns {boolean}
 */
export function hasImagesInMessages(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some(m => {
    if (m.images && Array.isArray(m.images) && m.images.length > 0) return true;
    if (Array.isArray(m.content)) {
      return m.content.some(part => part && part.type === 'image_url');
    }
    return false;
  });
}

/**
 * Determine if an API error is likely caused by image / multimodal payload rejection
 * @param {Error|Object} err
 * @returns {boolean}
 */
export function isImageRejectionError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  const msg = String(err.message || err.body || '').toLowerCase();

  // Explicit keyword indications of vision/multimodal rejection
  const visionKeywords = [
    'image',
    'vision',
    'multimodal',
    'image_url',
    'expected a string',
    'expected string',
    'does not support',
    'not support',
    'invalid content',
    'invalid_request_error',
    'messages[',
    'content[',
    'schema validation'
  ];

  if (visionKeywords.some(kw => msg.includes(kw))) {
    return true;
  }

  // 400 Bad Request or 422 Unprocessable Entity often indicates payload schema mismatch
  if (status === 400 || status === 422) {
    return true;
  }

  return false;
}

/**
 * Repackage messages for text-only retry when an image rejection error occurs.
 * Replaces image payloads with explanatory text so the model can acknowledge and decide how to reply.
 *
 * @param {Array<Object>} messages
 * @param {string} modelId
 * @returns {Array<Object>} Repackaged messages without image payloads
 */
export function repackageMessagesWithoutImages(messages, modelId = '') {
  if (!Array.isArray(messages)) return [];
  const modelName = (modelId || '當前模型').split('/').pop();

  return messages.map(m => {
    // Case A: Multimodal content array [ { type: 'text', text: ... }, { type: 'image_url', ... } ]
    if (Array.isArray(m.content)) {
      const textParts = m.content.filter(p => p && p.type === 'text').map(p => p.text);
      const imageCount = m.content.filter(p => p && p.type === 'image_url').length;

      if (imageCount > 0) {
        const baseText = textParts.join('\n').trim();
        const mainText = baseText || '（使用者傳送了圖片）';
        const notice = `\n\n[系統通知：使用者在此訊息中附帶了 ${imageCount} 張圖片，但 API 回報當前模型「${modelName}」不支援圖片/多模態輸入。系統已自動屏蔽影像資料。請向使用者說明您目前不支援圖片辨識，並由您決定如何回覆（例如建議使用者切換至支援視覺辨識的模型，或請使用者以文字描述圖片內容）。]`;

        return {
          ...m,
          content: mainText + notice
        };
      }
      return m;
    }

    // Case B: Raw message with images array
    if (m.images && Array.isArray(m.images) && m.images.length > 0) {
      const baseText = typeof m.content === 'string' ? m.content.trim() : '';
      const mainText = baseText || '（使用者傳送了圖片）';
      const imageCount = m.images.length;
      const notice = `\n\n[系統通知：使用者在此訊息中附帶了 ${imageCount} 張圖片，但 API 回報當前模型「${modelName}」不支援圖片/多模態輸入。系統已自動屏蔽影像資料。請向使用者說明您目前不支援圖片辨識，並由您決定如何回覆（例如建議使用者切換至支援視覺辨識的模型，或請使用者以文字描述圖片內容）。]`;

      return {
        ...m,
        content: mainText + notice,
        images: []
      };
    }

    return m;
  });
}
