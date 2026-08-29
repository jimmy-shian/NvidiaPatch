/**
 * Gateway Skills 預設注入器（Skill System Prompt Injector）
 *
 * 設計目標：
 *  1. 每次 /v1/chat/completions 請求都自動把預設 skills 注入到
 *     `messages` 的開頭作為 system message。
 *  2. 注入位置：
 *     - 若使用者沒有提供任何 system message → 在最前面新增一則
 *       合併所有預設 skill 內容的 system message。
 *     - 若使用者已提供 system message → 把預設 skill 內容附加在
 *       第一則 system message 的 content 開頭（保留後續內容）。
 *  3. 預設開關：可透過環境變數 `GATEWAY_DISABLE_DEFAULT_SKILLS=1`
 *     暫時關閉預設注入（除錯用）。
 *
 * 新增預設 skill：於本檔 `DEFAULT_SKILLS` 陣列 push 對應模組即可。
 * 每個 skill 模組需匯出：
 *   - name     : skill 名稱（除錯用）
 *   - content  : 要注入的 system prompt 字串
 *   - source?  : 出處 URL（選填，僅用於 log）
 */

const iHaveAdhdZhTw = require('./i-have-adhd-zh-tw');
const engineeringDiscipline = require('./engineering-discipline');

const DEFAULT_SKILLS = [
  iHaveAdhdZhTw,
  engineeringDiscipline
];

const SYSTEM_ROLE = 'system';

function isDisabledByEnv() {
  const raw = String(process.env.GATEWAY_DISABLE_DEFAULT_SKILLS || '').trim();
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function buildAggregatedSystemContent() {
  return DEFAULT_SKILLS
    .map((skill, index) => {
      const header = `### Skill ${index + 1}: ${skill.name}`;
      const sourceLine = skill.source ? `\n（來源：${skill.source}）` : '';
      return `${header}${sourceLine}\n\n${skill.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * 把預設 skills 注入到 messages 陣列的 system 區段。
 *
 * 規則：
 *  - messages 不是陣列時，原樣回傳。
 *  - 找到第一則 role === 'system' 的訊息，把預設內容 prepend 到它的 content 開頭。
 *  - 找不到時，在 messages[0] 前新增一則 system message。
 *
 * @param {Array} messages
 * @returns {Array} 新的 messages 陣列（不會改動原陣列）
 */
function injectDefaultSkills(messages) {
  if (isDisabledByEnv()) return messages;
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (DEFAULT_SKILLS.length === 0) return messages;

  const aggregated = buildAggregatedSystemContent();
  const result = messages.slice();
  const firstSystemIndex = result.findIndex(
    (m) => m && typeof m === 'object' && m.role === SYSTEM_ROLE
  );

  if (firstSystemIndex >= 0) {
    const original = result[firstSystemIndex];
    if (typeof original.content === 'string') {
      const newContent = aggregated + '\n\n---\n\n' + original.content;
      result[firstSystemIndex] = { ...original, content: newContent };
    } else if (Array.isArray(original.content)) {
      result[firstSystemIndex] = {
        ...original,
        content: [
          { type: 'text', text: aggregated + '\n\n---\n\n' },
          ...original.content
        ]
      };
    } else {
      const originalContent = original.content == null ? '' : JSON.stringify(original.content);
      const newContent = aggregated + '\n\n---\n\n' + originalContent;
      result[firstSystemIndex] = { ...original, content: newContent };
    }
    return result;
  }

  return [{ role: SYSTEM_ROLE, content: aggregated }, ...result];
}

module.exports = {
  injectDefaultSkills,
  buildAggregatedSystemContent,
  DEFAULT_SKILLS,
  isDisabledByEnv
};