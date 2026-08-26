/**
 * Skill Manager
 * Dual-layer skill management: Built-in Readonly Skills + User Custom/Overridden Skills.
 */
import { BUILTIN_SKILLS } from './builtinSkills';
import { parseSkillMarkdown } from './skillParser';
import { LocalDB } from '../storage/localDatabase';

export const SkillManager = {
  /**
   * Get all skills (built-in merged with user skills, user skills take precedence)
   */
  async getAllSkills() {
    const userSkills = await LocalDB.getUserSkills();
    const userMap = new Map(userSkills.map(s => [s.id, s]));

    const merged = [];

    // Process builtin skills
    for (const builtin of BUILTIN_SKILLS) {
      if (userMap.has(builtin.id)) {
        merged.push({
          ...builtin,
          ...userMap.get(builtin.id),
          isOverridden: true
        });
        userMap.delete(builtin.id);
      } else {
        merged.push({
          ...builtin,
          isOverridden: false
        });
      }
    }

    // Append any purely custom user skills
    for (const custom of userMap.values()) {
      merged.push({
        ...custom,
        isCustom: true
      });
    }

    return merged;
  },

  /**
   * Get a single skill by ID
   */
  async getSkillById(id) {
    const all = await this.getAllSkills();
    return all.find(s => s.id === id) || null;
  },

  /**
   * Import a skill from Markdown text
   */
  async importSkillFromMarkdown(markdownText, fallbackId = '') {
    const parsed = parseSkillMarkdown(markdownText, fallbackId);
    if (!parsed) {
      throw new Error('Invalid Skill Markdown content');
    }
    const saved = await LocalDB.saveUserSkill({
      ...parsed,
      isCustom: true
    });
    return saved;
  },

  /**
   * Save or update a custom skill
   */
  async saveSkill(skill) {
    return LocalDB.saveUserSkill(skill);
  },

  /**
   * Delete or restore a skill
   */
  async deleteSkill(id) {
    await LocalDB.deleteUserSkill(id);
  },

  /**
   * Construct System Prompt for selected skills
   */
  async buildSkillSystemMessage(selectedSkillIds) {
    if (!selectedSkillIds || selectedSkillIds.length === 0) return null;

    const allSkills = await this.getAllSkills();
    const selected = allSkills.filter(s => selectedSkillIds.includes(s.id));

    if (selected.length === 0) return null;

    const skillNames = selected.map(s => `「${s.name}」`).join('、');

    const header = selected.length === 1
      ? `=== 🔴 使用者已啟用專屬技能 (ACTIVE SPECIALIZED SKILL): ${selected[0].name} (ID: ${selected[0].id}) ===
【最高遵循優先權指令 (MANDATORY EXECUTION DIRECTIVE)】
使用者已明確為當前對話啟用 ${selected[0].name} 技能。你必須完全切換至該領域的專家視角與思考模式：
1. 嚴格遵循手冊：徹底執行手冊中規範的分析步驟、專業邏輯、專用術語與排版格式。
2. 拒絕通用泛答：嚴禁退化為通用的 AI 答覆或模板式套話，必須依據手冊框架進行深度、具體、專業的分析。
3. 結構化呈現：若手冊包含特定盤面排版、步驟分段或輸出樣式，必須精確呈現。
4. 工具輔助：如需時間、即時資料或外部驗證，應主動調用相關工具。\n\n`
      : `=== 🔴 使用者已啟用多項整合技能 (ACTIVE SPECIALIZED SKILLS - ${selected.length} 項整合): ${skillNames} ===
【最高遵循優先權指令 (MANDATORY EXECUTION DIRECTIVE)】
使用者已明確為當前對話啟用 ${selected.length} 項跨領域專家技能。你必須同時整合下列各項技能手冊，並以最高專業標準執行：
1. 跨領域交叉驗證：融合各技能領域的專業分析方法與洞察，提供全面而深度的解析。
2. 嚴格遵循手冊：各技能手冊內的專業流程、判定規則、排版規範與專用術語均為強制執行的操作準則。
3. 拒絕通用泛答：禁止使用泛泛而談的敷衍回答，必須嚴格落實各手冊的步驟與方法論。\n\n`;

    const body = selected.map((s, index) => {
      const content = s.instructions || s.rawContent || '';
      return `--------------------------------------------------------------------------------
【技能 ${index + 1}/${selected.length} 操作手冊：${s.name} (${s.id})】
${content.trim()}
--------------------------------------------------------------------------------`;
    }).join('\n\n');

    return header + body;
  }
};
