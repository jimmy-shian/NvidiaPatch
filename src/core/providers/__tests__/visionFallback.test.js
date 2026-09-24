import { describe, it, expect } from 'vitest';
import {
  hasImagesInMessages,
  isImageRejectionError,
  repackageMessagesWithoutImages
} from '../visionCapabilities';

describe('Vision Reactive Fallback & Repackaging Handler', () => {
  it('correctly detects whether messages contain image inputs', () => {
    expect(hasImagesInMessages([])).toBe(false);
    expect(hasImagesInMessages([
      { role: 'user', content: '純文字訊息' }
    ])).toBe(false);

    // With images array
    expect(hasImagesInMessages([
      { role: 'user', content: '請看這張圖', images: ['data:image/png;base64,...'] }
    ])).toBe(true);

    // With OpenAI multimodal parts array
    expect(hasImagesInMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: '請看這張圖' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
        ]
      }
    ])).toBe(true);
  });

  it('identifies image rejection errors accurately', () => {
    // Standard HTTP 400 Bad Request
    expect(isImageRejectionError({ status: 400, message: 'Bad Request' })).toBe(true);
    // Explicit vision / multimodal error messages
    expect(isImageRejectionError({ message: 'Model does not support vision or image_url' })).toBe(true);
    expect(isImageRejectionError({ message: 'Invalid content: expected a string' })).toBe(true);
    expect(isImageRejectionError({ message: 'multimodal input is not supported for this model' })).toBe(true);

    // Unrelated errors should not be flagged if status is not 400/422
    expect(isImageRejectionError({ status: 401, message: 'Invalid API Key' })).toBe(false);
    expect(isImageRejectionError({ status: 429, message: 'Rate limit exceeded' })).toBe(false);
  });

  it('repackages messages by stripping image_url and injecting clear notice for the model', () => {
    const originalMessages = [
      { role: 'system', content: 'You are an assistant.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '請幫我看這張紫微斗數命盤圖片' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }
        ]
      }
    ];

    const repackaged = repackageMessagesWithoutImages(originalMessages, 'deepseek-ai/deepseek-chat');

    // System prompt remains unchanged
    expect(repackaged[0].content).toBe('You are an assistant.');

    // User message is converted to text string without image parts
    expect(typeof repackaged[1].content).toBe('string');
    expect(repackaged[1].content).toContain('請幫我看這張紫微斗數命盤圖片');
    expect(repackaged[1].content).toContain('[系統通知：使用者在此訊息中附帶了 1 張圖片');
    expect(repackaged[1].content).toContain('deepseek-chat');
    expect(repackaged[1].content).toContain('請向使用者說明您目前不支援圖片辨識，並由您決定如何回覆');
  });

  it('repackages messages with images array format', () => {
    const originalMessages = [
      {
        role: 'user',
        content: '',
        images: ['https://example.com/1.png', 'https://example.com/2.png']
      }
    ];

    const repackaged = repackageMessagesWithoutImages(originalMessages, 'meta/llama-3.1-8b-instruct');

    expect(typeof repackaged[0].content).toBe('string');
    expect(repackaged[0].images).toEqual([]);
    expect(repackaged[0].content).toContain('2 張圖片');
    expect(repackaged[0].content).toContain('llama-3.1-8b-instruct');
  });
});
