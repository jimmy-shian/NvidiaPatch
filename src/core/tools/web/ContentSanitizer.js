/**
 * Web Content Sanitizer & Budget Controller
 * Enforces per-page and total token/character budgets and strips injection patterns.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/gi,
  /system\s+prompt\s*:/gi,
  /reveal\s+(your\s+)?api\s*key/gi,
  /output\s+(your\s+)?api\s*key/gi,
  /disregard\s+(all\s+)?(previous|above)\s+instructions/gi,
  /you\s+are\s+now\s+in\s+developer\s+mode/gi
];

/**
 * Sanitize webpage text and enforce character budget
 * @param {string} text
 * @param {Object} options
 * @returns {string} Sanitized clean text
 */
export function sanitizeWebContent(text, options = {}) {
  const { maxChars = 5000 } = options;
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // Filter known injection trigger phrases
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[filtered external instruction]');
  }

  // Enforce budget
  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars) + '\n\n[... 內容過長已自動截斷 (Content truncated) ...]';
  }

  return cleaned.trim();
}
