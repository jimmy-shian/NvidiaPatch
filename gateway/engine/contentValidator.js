/**
 * 內容校驗器核心門面（Content Validator Facade）
 *
 * 整合：
 *  1. 急速標記掃描器（fastTagScanner）
 *  2. 上游錯誤偵測器（upstreamErrorDetector）
 *
 * 提供向下相容的介面：
 *  - validateContent(content, options)
 *  - smartValidate(content, options)
 *  - quickValidate(content, options)
 *  - formatValidationIssue(validation)
 *  - isUpstreamErrorContent(content)
 */

const { scanTags } = require('./fastTagScanner');
const { isUpstreamErrorContent, extractUpstreamErrorDetail } = require('./upstreamErrorDetector');

/**
 * 驗證文字內容中的標記結構完整性。
 */
function validateContent(content, options = {}) {
  return scanTags(content, options);
}

/**
 * 智慧快速校驗（Smart Validate）
 * 由於 scanTags 具備 O(n) 單次原生正則掃描能力，在此直接進行極速全量校驗。
 */
function smartValidate(content, options = {}) {
  if (!content || typeof content !== 'string') {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }
  return scanTags(content, options);
}

/**
 * 快速預檢（保留作為相容性接口）
 */
function quickValidate(content, options = {}) {
  return smartValidate(content, options);
}

/**
 * 將校驗錯誤物件格式化為人類可讀字串
 */
function formatValidationIssue(validation) {
  if (!validation || validation.valid) return '';
  const issues = [];
  if (validation.unclosedTags && validation.unclosedTags.length > 0) {
    issues.push(`未閉合標記: ${validation.unclosedTags.map(t => `<${t}>`).join(', ')}`);
  }
  if (validation.mismatchedTags && validation.mismatchedTags.length > 0) {
    issues.push(`不匹配標記: ${validation.mismatchedTags.join(', ')}`);
  }
  if (validation.malformedTags && validation.malformedTags.length > 0) {
    issues.push(`格式不完整標記: ${validation.malformedTags.join(', ')}`);
  }
  return issues.join('; ') || '標記結構異常';
}

module.exports = {
  validateContent,
  smartValidate,
  quickValidate,
  formatValidationIssue,
  isUpstreamErrorContent,
  extractUpstreamErrorDetail
};

