/**
 * 急速標記掃描器（Fast Tag Scanner）
 *
 * 使用 V8 原生層正則引擎進行單次掃描（Single-Pass Native Scanning），
 * 自動跳過 Code Block、Inline Code、HTML 註解、CDATA、網址與泛型語法，
 * 並以 O(1) 堆疊追蹤 XML / HTML 標記的配對狀態。
 */

const { VOID_TAGS, FAST_SCAN_REGEX } = require('./constants');

/**
 * 快速校驗文字內容中的 XML / HTML 標記完整性。
 *
 * @param {string} content - 待校驗文字
 * @param {object} [options]
 * @param {number} [options.maxErrors=20] - 最大錯誤收集數
 * @param {number} [options.maxLength] - 最大掃描長度（預設全量掃描）
 * @returns {{ valid: boolean, unclosedTags: string[], malformedTags: string[], mismatchedTags: string[] }}
 */
function scanTags(content, options = {}) {
  if (!content || typeof content !== 'string') {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  // 快速短路：無角括號時直接回傳合法（微秒級 O(1)）
  if (!content.includes('<')) {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  const maxLength = options.maxLength || content.length;
  const scanContent = content.length > maxLength ? content.slice(0, maxLength) : content;

  // 快速正則預檢：若無任何可能的標記起始，直接跳過
  if (!/<[a-zA-Z_/?!]/.test(scanContent)) {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  const maxErrors = options.maxErrors || 20;
  const stack = [];
  const mismatchedTags = [];
  let matchedCount = 0;

  // 重設全域正則指標
  FAST_SCAN_REGEX.lastIndex = 0;
  let match;

  while ((match = FAST_SCAN_REGEX.exec(scanContent)) !== null) {
    const tagNameRaw = match[2];

    // match[2] 為空表示匹配到了程式碼圍欄、行內程式碼、註解、CDATA 或網址，直接跳過
    if (!tagNameRaw) {
      continue;
    }

    const isClosing = match[1] === '/';

    // 檢查是否為程式語言的泛型型別宣告（例如 List<String>、Map<K, V>、Collections.<String>）
    // 泛型特徵：在 '<' 前方緊鄰英文字母、數字、底線或點號
    if (!isClosing && match.index > 0) {
      const prevChar = scanContent[match.index - 1];
      if (/[a-zA-Z0-9_.]/.test(prevChar)) {
        continue;
      }
    }

    const isSelfClosing = match[3] === '/' || VOID_TAGS.has(tagNameRaw.toLowerCase());
    const tagName = tagNameRaw.toLowerCase();

    if (isClosing) {
      if (stack.length === 0) {
        mismatchedTags.push(`</${tagNameRaw}>`);
      } else if (stack[stack.length - 1] === tagName) {
        stack.pop();
        matchedCount += 1;
      } else {
        // 尋找堆疊中是否有匹配的標記（處理跨層未閉合或跳層）
        let foundIdx = -1;
        for (let s = stack.length - 2; s >= 0; s -= 1) {
          if (stack[s] === tagName) {
            foundIdx = s;
            break;
          }
        }

        if (foundIdx !== -1) {
          // 將該標記上方的所有未閉合標記彈出
          while (stack.length > foundIdx) {
            stack.pop();
          }
          matchedCount += 1;
        } else {
          mismatchedTags.push(`</${tagNameRaw}>`);
        }
      }

      if (mismatchedTags.length >= maxErrors) {
        break;
      }
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
  }

  const hasLeftover = stack.length > 0;
  const hasMismatched = mismatchedTags.length > 0;

  if (hasLeftover || hasMismatched) {
    return {
      valid: false,
      unclosedTags: [...new Set(stack)],
      malformedTags: [],
      mismatchedTags: [...new Set(mismatchedTags)].slice(0, 8)
    };
  }

  return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
}

module.exports = {
  scanTags
};
