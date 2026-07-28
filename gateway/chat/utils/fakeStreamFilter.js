/**
 * Fake Stream 過濾工具
 *
 * 辨識並過濾僅含私有字元 \uE000 的假串流 chunk。
 * 使用統一常數與函式，避免在 responseValidator/ssePayloadBuilder/responseWriter 重複實作。
 */

const FAKE_CHAR = '\uE000';

/**
 * 檢查 content 是否只包含假串流字元（或空字串）。
 * @param {string} content
 * @returns {boolean}
 */
function isFakeStreamContent(content) {
  if (typeof content !== 'string') return false;
  if (content.length === 0) return false;
  // 只包含 FAKE_CHAR（重複多次）即判定為假串流。
  return /^\uE000+$/.test(content);
}

/**
 * 清理字串：去掉所有假串流字元。
 * @param {string} content
 * @returns {string}
 */
function stripFakeStreamChars(content) {
  if (typeof content !== 'string') return content;
  return content.replace(/\uE000+/g, '');
}

module.exports = {
  FAKE_CHAR,
  isFakeStreamContent,
  stripFakeStreamChars
};