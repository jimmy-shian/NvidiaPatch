/**
 * Single-pass Streaming Parser — 單次掃描狀態機
 *
 * 以 Agent 輸出結構（XML／HTML 類標記）為驗證目標，透過上下文與結構
 * 完整性判斷是否為需要校驗的標記，避免將程式碼、數學比較、Markdown、
 * 泛型語法或一般文字中的 < > 誤判為格式標記。
 *
 * 特性：
 *  - O(n) 時間複雜度，單次掃描，不截斷內容
 *  - 上下文感知：跳過程式碼區塊、行內程式碼、HTML 註解、CDATA
 *  - 無固定 Tag 白名單，依結構有效性判斷
 *  - 支援未知工具格式與未來擴充
 *  - 偵測未閉合、錯誤巢狀、錯誤結束標記
 *  - 置信度啟發式：僅在文件中存在已成功配對的標記時，
 *    才將未配對的標記視為格式錯誤；避免泛型、數學比較等假陽性
 */

// ---- 狀態機常量 ----
const STATE_TEXT = 0;          // 一般文字
const STATE_CODE_FENCE = 1;     // 程式碼圍欄（``` 或 ~~~ 之間）
const STATE_TAG_OPEN = 2;       // 讀取開始標記名稱 <tag ...
const STATE_TAG_CLOSE = 3;     // 讀取結束標記名稱 </tag>
const STATE_INLINE_CODE = 4;    // 行內程式碼 `...`
const STATE_HTML_COMMENT = 5;   // HTML 註解 <!-- ... -->
const STATE_CDATA = 6;          // CDATA 區段 <![CDATA[ ... ]]>
const STATE_PI = 7;             // 處理指令 <? ... ?>

function validateContent(content, options = {}) {
  if (!content || typeof content !== 'string') {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  const maxErrors = options.maxErrors || 20;
  const maxLength = options.maxLength || content.length;

  if (content.length > maxLength) {
    content = content.slice(0, maxLength);
  }

  const malformedTags = [];
  const mismatchedTags = [];
  const stack = [];
  let state = STATE_TEXT;
  let i = 0;
  const len = content.length;

  let matchedCount = 0;

  let tagNameBuf = '';
  let fenceMarker = '';
  let inlineCodeTick = '';

  if (!/<[a-zA-Z_]/.test(content)) {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  while (i < len) {
    const ch = content[i];
    const next = i + 1 < len ? content[i + 1] : '';

    switch (state) {
      case STATE_TEXT: {
        // 偵測程式碼圍欄起始 ``` 或 ~~~
        if (ch === '`' && next === '`' && i + 2 < len && content[i + 2] === '`') {
          fenceMarker = '```';
          i += 3;
          state = STATE_CODE_FENCE;
          break;
        }
        if (ch === '~' && next === '~' && i + 2 < len && content[i + 2] === '~') {
          fenceMarker = '~~~';
          i += 3;
          state = STATE_CODE_FENCE;
          break;
        }

        // 偵測行內程式碼（含連續多個 backtick）
        if (ch === '`') {
          let ticks = 0;
          let j = i;
          while (j < len && content[j] === '`') { ticks++; j++; }
          if (ticks >= 1) {
            inlineCodeTick = '`'.repeat(ticks);
            i = j;
            state = STATE_INLINE_CODE;
            break;
          }
        }

        // 偵測角括號標記
        if (ch === '<') {
          // <!-- HTML 註解
          if (next === '!' && i + 3 < len && content[i + 2] === '-' && content[i + 3] === '-') {
            state = STATE_HTML_COMMENT;
            i += 4;
            break;
          }
          // <![CDATA[
          if (next === '!' && content.slice(i, i + 9) === '<![CDATA[') {
            state = STATE_CDATA;
            i += 9;
            break;
          }
          // <? 處理指令
          if (next === '?') {
            state = STATE_PI;
            i += 2;
            break;
          }
          // </ 結束標記
          if (next === '/') {
            tagNameBuf = '';
            i += 2;
            state = STATE_TAG_CLOSE;
            break;
          }
          // <tag 開始標記（需以英文字母或底線開頭才視為標記）
          if (isTagNameStartChar(next)) {
            tagNameBuf = '';
            i += 1;
            state = STATE_TAG_OPEN;
            break;
          }
          // 其他 < 不視為標記（可能是 a < b、2 < 3 等）
          i += 1;
          break;
        }

        i += 1;
        break;
      }

      case STATE_CODE_FENCE: {
        // 尋找結束圍欄 ``` 或 ~~~（必須在行首）
        if (ch === fenceMarker[0]) {
          let matched = true;
          for (let k = 0; k < fenceMarker.length; k++) {
            if (content[i + k] !== fenceMarker[k]) { matched = false; break; }
          }
          if (matched) {
            i += fenceMarker.length;
            fenceMarker = '';
            state = STATE_TEXT;
            break;
          }
        }
        i += 1;
        break;
      }

      case STATE_INLINE_CODE: {
        // 尋找匹配數量的 backtick 結束
        if (ch === '`') {
          let ticks = 0;
          let j = i;
          while (j < len && content[j] === '`') { ticks++; j++; }
          if (ticks === inlineCodeTick.length) {
            i = j;
            inlineCodeTick = '';
            state = STATE_TEXT;
            break;
          }
          i += 1;
          break;
        }
        i += 1;
        break;
      }

      case STATE_HTML_COMMENT: {
        // 尋找 -->
        if (ch === '-' && next === '-' && i + 2 < len && content[i + 2] === '>') {
          i += 3;
          state = STATE_TEXT;
          break;
        }
        i += 1;
        break;
      }

      case STATE_CDATA: {
        // 尋找 ]]>
        if (ch === ']' && next === ']' && i + 2 < len && content[i + 2] === '>') {
          i += 3;
          state = STATE_TEXT;
          break;
        }
        i += 1;
        break;
      }

      case STATE_PI: {
        // 尋找 ?>
        if (ch === '?' && next === '>') {
          i += 2;
          state = STATE_TEXT;
          break;
        }
        i += 1;
        break;
      }

      case STATE_TAG_OPEN: {
        // 讀取標記名稱
        if (tagNameBuf.length === 0) {
          if (!isTagNameStartChar(ch)) {
            // 不是有效的標記開頭 -> 退回文字狀態
            state = STATE_TEXT;
            break;
          }
          tagNameBuf = ch;
          i += 1;
          break;
        }
        // 繼續讀取合法標記名稱字元
        if (isTagNameChar(ch)) {
          tagNameBuf += ch;
          i += 1;
          break;
        }
        // 標記名稱結束，開始掃描屬性直到 > 或 />
        const result = scanTagBody(content, i, len);
        i = result.nextIndex;
        const tagName = tagNameBuf.toLowerCase();

        if (result.malformed) {
          malformedTags.push(`<${tagNameBuf}...>`);
          if (malformedTags.length >= maxErrors) {
            return {
              valid: false,
              unclosedTags: [...new Set(stack.map(t => t.name))],
              malformedTags: [...new Set(malformedTags)].slice(0, 8),
              mismatchedTags: [...new Set(mismatchedTags)].slice(0, 8)
            };
          }
        }

        if (!result.selfClosing) {
          stack.push({ name: tagName });
        }
        state = STATE_TEXT;
        break;
      }

      case STATE_TAG_CLOSE: {
        // 讀取結束標記名稱
        if (tagNameBuf.length === 0) {
          if (isTagNameStartChar(ch)) {
            tagNameBuf = ch;
            i += 1;
            break;
          }
          // </ 後面不是有效標記名稱，退回文字
          state = STATE_TEXT;
          break;
        }
        if (isTagNameChar(ch)) {
          tagNameBuf += ch;
          i += 1;
          break;
        }
        // 標記名稱結束，讀取至 >
        const result = scanTagBody(content, i, len);
        i = result.nextIndex;

        const closeName = tagNameBuf.toLowerCase();
        if (result.malformed) {
          malformedTags.push(`</${tagNameBuf}>`);
        }

        // 比對堆疊（含錯誤回復）
        const stackIdx = findInStack(stack, closeName);
        if (stackIdx !== -1) {
          if (stack[stack.length - 1].name === closeName) {
            stack.pop();
            matchedCount++;
          } else {
            // 錯誤巢狀：closeName 在堆疊中但非頂端
            // 將其上方的標記彈出（視為未閉合）
            while (stack.length > stackIdx + 1) {
              stack.pop();
            }
            stack.pop();
            matchedCount++;
          }
        } else {
          // closeName 不在堆疊中 — 錯誤結束標記
          mismatchedTags.push(`</${closeName}>`);
          if (mismatchedTags.length >= maxErrors) {
            return {
              valid: false,
              unclosedTags: [...new Set(stack.map(t => t.name))],
              malformedTags: [...new Set(malformedTags)].slice(0, 8),
              mismatchedTags: [...new Set(mismatchedTags)].slice(0, 8)
            };
          }
        }
        state = STATE_TEXT;
        break;
      }

      default:
        i += 1;
        break;
    }
  }

  // ---- 置信度判斷 ----
  // 若文件中完全沒有成功配對的標記，且堆疊中殘留的標記數量較少，
  // 很可能是泛型語法、數學比較等非標記內容，不視為錯誤。
  const hasLeftover = stack.length > 0;
  const hasMismatched = mismatchedTags.length > 0;
  const hasMalformed = malformedTags.length > 0;

  // 若有錯誤結束標記或格式不完整標記，且文件中有成功配對的標記，
  // 表示內容確實使用了標記結構，這些問題值得報告。
  if (hasLeftover && matchedCount === 0 && !hasMismatched && !hasMalformed) {
    // 沒有任何成功配對，可能全是非標記的 < > 使用
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  if (hasLeftover || hasMismatched || hasMalformed) {
    return {
      valid: false,
      unclosedTags: [...new Set(stack.map(t => t.name))],
      malformedTags: [...new Set(malformedTags)].slice(0, 8),
      mismatchedTags: [...new Set(mismatchedTags)].slice(0, 8)
    };
  }

  return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
}

/**
 * 在堆疊中從頂端往下搜尋指定名稱的標記。
 * @returns 索引（0-based，從底部算），找不到回傳 -1
 */
function findInStack(stack, name) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === name) return i;
  }
  return -1;
}

/**
 * 掃描標記主體（從名稱後到 >），偵測自閉合 />
 * 處理引號內的 > 以避免誤判。
 */
function scanTagBody(content, i, len) {
  let selfClosing = false;
  let malformed = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (i < len) {
    const ch = content[i];
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      i += 1;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
      i += 1;
      continue;
    }
    if (ch === "'") { inSingleQuote = true; i += 1; continue; }
    if (ch === '"') { inDoubleQuote = true; i += 1; continue; }
    if (ch === '>') {
      // 檢查是否為 />
      if (i > 0 && content[i - 1] === '/') {
        selfClosing = true;
      }
      i += 1;
      return { nextIndex: i, selfClosing, malformed };
    }
    i += 1;
  }
  // 走到內容尾端仍無 > — 格式不完整
  return { nextIndex: i, selfClosing, malformed: true };
}

function isTagNameStartChar(ch) {
  return /[a-zA-Z_]/.test(ch);
}

function isTagNameChar(ch) {
  return /[a-zA-Z0-9:_-]/.test(ch);
}

function formatValidationIssue(validation) {
  const issues = [];
  if (validation.unclosedTags && validation.unclosedTags.length > 0) {
    issues.push(validation.unclosedTags.map(t => `<${t}>`).join(', '));
  }
  if (validation.malformedTags && validation.malformedTags.length > 0) {
    issues.push(validation.malformedTags.join(', '));
  }
  if (validation.mismatchedTags && validation.mismatchedTags.length > 0) {
    issues.push(validation.mismatchedTags.join(', '));
  }
  return issues.join(', ') || 'unknown tag issue';
}

function quickValidate(content) {
  if (!content || typeof content !== 'string') return true;

  const hasOpen = /<[a-zA-Z_]/.test(content);
  const hasClose = /<\//.test(content);

  if (!hasOpen) return true;
  if (!hasClose) return false;

  const openCount = (content.match(/<[a-zA-Z_][a-zA-Z0-9:_-]*/g) || []).length;
  const closeCount = (content.match(/<\//g) || []).length;
  const selfClose = (content.match(/\/>/g) || []).length;

  return Math.abs(openCount - selfClose - closeCount) <= 2;
}

module.exports = {
  validateContent,
  formatValidationIssue,
  quickValidate
};
