/**
 * 內容校驗器常數定義（Content Validator Constants）
 */

// 標準 HTML Void 元素（無需結束標記）
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr'
]);

/**
 * V8 原生層急速正則掃描器：
 *  - 程式碼圍欄（```...``` 或 ~~~...~~~）
 *  - 行內程式碼（`...`）
 *  - HTML 註解（<!--...-->）
 *  - CDATA 區段（<![CDATA[...]]>）
 *  - 處理指令（<?...?>）
 *  - Markdown 網址標記（<https:...> 或 <http:...>）
 *  - XML / HTML 標記（<(/)?([tag_name]) ... (/)? >）
 */
const FAST_SCAN_REGEX = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[^>]*\?>|<https?:[^>]+>|<(\/)?([a-zA-Z_][a-zA-Z0-9:._-]*)(?:\s+(?:[^>"]|"[^"]*"|'[^']*')*)?(\/)?>/g;

module.exports = {
  VOID_TAGS,
  FAST_SCAN_REGEX
};
