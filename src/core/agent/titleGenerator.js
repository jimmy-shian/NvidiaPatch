/**
 * titleGenerator.js
 * Lightweight LLM Conversation Title Generator
 *
 * Uses a single concise prompt to let the LLM generate the conversation title
 * based on the user's first question with minimal token consumption.
 * Handles thinking models by filtering reasoning tokens and avoids arbitrary length truncations.
 */
import { StreamReasoningParser } from './reasoningParser';

/**
 * Clean and format the raw LLM title output.
 * Strips think tags, labels, quotes, and punctuation without arbitrary hard truncation.
 */
export function cleanGeneratedTitle(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText;

  // 1. Strip in-band think/thought tags (both closed and unclosed)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  text = text.replace(/<\|thought\|>[\s\S]*?<\|endofthought\|>/gi, '');
  text = text.replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '');
  text = text.replace(/<think>[\s\S]*/gi, '');
  text = text.replace(/<thought>[\s\S]*/gi, '');
  text = text.replace(/<\|thought\|>[\s\S]*/gi, '');
  text = text.replace(/<\/?(think|thought|\|thought\||\/thought\||endofthought)>/gi, '');
  text = text.replace(/\uE000+/g, '');

  // 2. Remove code blocks and markdown formatting
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/[*_~`#]+/g, '');

  // 3. Extract the first meaningful line
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  text = lines[0] || '';

  // 4. Strip common AI prefix labels
  text = text.replace(/^(對話標題|標題|主題|建議標題|Chat\s*Title|Title|Topic|Subject)\s*[:：\-—]\s*/i, '');
  text = text.replace(/^(這是一個關於|本對話關於|討論|關於)\s*/i, '');

  // 5. Strip quotes, brackets, and trailing punctuation
  text = text.replace(/^["'「」『』《》“”‘’【】\[\]()（）]+|["'「」『』《》“”‘’【】\[\]()（）]+$/g, '').trim();
  text = text.replace(/^[：:,，\s\-—]+/, '').trim();
  text = text.replace(/[。！？\?!，,；;：:]+$/g, '').trim();

  return text;
}

/**
 * Generate conversation title from user's first prompt using a single concise LLM call.
 * Minimal token consumption with support for thinking models.
 *
 * @param {Object} params
 * @param {string} params.prompt - User's first question
 * @param {Object} params.provider - LLM provider instance
 * @param {string} params.model - Model identifier
 * @returns {Promise<string>} Cleaned conversation title
 */
export async function generateTitleFromPrompt({ prompt, provider, model }) {
  if (!prompt || !provider || !model) {
    return '新對話';
  }

  try {
    const userQueryPreview = prompt.trim().slice(0, 150);

    // Single concise prompt to minimize token usage
    const messages = [
      {
        role: 'user',
        content: `請為以下使用者的問題產生一個簡短精確的對話主題標題（繁體中文，約4到10個字）。直接輸出標題文字，嚴禁思考過程、引號、標點符號或前綴說明：\n\n${userQueryPreview}`
      }
    ];

    const stream = provider.chatStream({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 120
    });

    let rawContent = '';
    const parser = new StreamReasoningParser({
      onThinking: () => {}, // Discard reasoning/thinking tokens
      onContent: (delta) => {
        rawContent += delta;
      }
    });

    for await (const chunk of stream) {
      if (chunk.type === 'thinking') {
        parser.processChunk({ delta: { reasoning_content: chunk.delta } });
      } else if (chunk.type === 'content') {
        parser.processChunk({ delta: { content: chunk.delta } });
      } else if (chunk.type === 'done') {
        break;
      }
    }
    parser.flush();

    const cleanedTitle = cleanGeneratedTitle(rawContent);
    if (cleanedTitle && cleanedTitle.length >= 2) {
      return cleanedTitle;
    }

    // Fallback: clean the first line of user query without hard slice truncation
    return cleanFallbackTitle(prompt);
  } catch (err) {
    console.warn('[generateTitleFromPrompt error]:', err);
    return cleanFallbackTitle(prompt);
  }
}

/**
 * Fallback title extractor from raw user prompt (when LLM call fails)
 */
export function cleanFallbackTitle(prompt) {
  if (!prompt || typeof prompt !== 'string') return '新對話';
  let text = prompt.trim();
  text = text.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1');
  text = text.replace(/^>+[^\n]*\n?/gm, ' ');
  text = text.replace(/^[#\s*\-+]+/gm, ' ');
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  text = text.replace(/^["'「」『』《》“”‘’]+|["'「」『』《》“”‘’]+$/g, '').trim();
  text = text.replace(/[。！？\?!，,；;：:]+$/g, '').trim();
  return text || '新對話';
}
