/**
 * Search Query Optimizer & Sanitizer
 * 
 * Rules:
 * 1. Deduplication fingerprinting to avoid repeating identical searches in the same run.
 * 2. Progressive Query Relaxation:
 *    - Preserves high-signal constraints (Dates like 2026-08-24, 2026年8月, model numbers like RTX 5090, V4, quoted terms, proper nouns).
 *    - Strips conversational boilerplate ("請幫我查", "我想知道", "的相關資訊", "是什麼").
 *    - Removes query syntax noise (excess boolean tokens, brackets).
 */

/**
 * Generate normalized fingerprint for deduplication
 * @param {string} query
 * @returns {string}
 */
export function generateQueryFingerprint(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .trim()
    .toLowerCase()
    .replace(/[\s\-_,.:;!?，。！？]+/g, ' ')
    .trim();
}

/**
 * Common conversational filler phrases in Chinese and English
 */
const CONVERSATIONAL_FILLERS = [
  /^(請幫我|幫我|請|我想知道|我想查詢|查詢一下|搜尋一下|查一下|找一下)\s*/gi,
  /\s*(最新的|相關的|詳細的)?(資料|資訊|新聞|消息|內容|情報|介紹|是什麼|有什麼|怎麼辦)$/gi,
  /\s*(please\s+)?(search\s+for|look\s+up|tell\s+me\s+about|what\s+is|find\s+information\s+about)\s*/gi,
  /\s*(latest\s+news|recent\s+updates|information|overview)$/gi
];

/**
 * Relax search query when first search yields zero or low results.
 * Preserves high-value tokens like dates (e.g. 2026-08-24), version numbers, and technical terms.
 * @param {string} query
 * @returns {string} Relaxed query
 */
export function relaxQuery(query) {
  if (!query || typeof query !== 'string') return '';
  let cleaned = query.trim();

  // 1. Remove outer quotes if wrapped
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith('\'') && cleaned.endsWith('\''))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // 2. Strip conversational wrappers
  for (const filler of CONVERSATIONAL_FILLERS) {
    cleaned = cleaned.replace(filler, '').trim();
  }

  // 3. Remove search operator noise (e.g. AND, OR, site:, filetype:)
  cleaned = cleaned
    .replace(/\b(AND|OR|NOT)\b/g, ' ')
    .replace(/\b(site|filetype|intitle|inurl):[^\s]+/gi, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If query is empty or unchanged after filler removal, return original
  if (!cleaned) {
    return query.trim();
  }

  return cleaned;
}

/**
 * Extract 2-4 core search keywords for broad search fallback
 * @param {string} query
 * @returns {string}
 */
export function extractCoreKeywords(query) {
  const relaxed = relaxQuery(query);
  if (!relaxed) return '';

  // Split into tokens
  const tokens = relaxed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 4) {
    return relaxed;
  }

  // Preserve tokens with numbers, dates (2026, 08-24), uppercase / English words, and significant terms
  const prioritized = [];
  const standard = [];

  for (const token of tokens) {
    if (/\d/.test(token) || /[a-zA-Z]/.test(token) || token.length >= 4) {
      prioritized.push(token);
    } else {
      standard.push(token);
    }
  }

  const combined = [...prioritized, ...standard].slice(0, 4);
  return combined.join(' ');
}
