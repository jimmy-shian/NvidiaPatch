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

    const header = selected.length === 1
      ? `=== ACTIVE SKILL: ${selected[0].name} ===\nYou are now operating under the ${selected[0].name} skill. Follow all instructions and workflows below precisely:\n\n`
      : `=== ACTIVE SKILLS (${selected.length} SKILLS COMBINED) ===\nYou are operating under ${selected.length} active skills simultaneously. Cross-reference insights across domains where applicable:\n\n`;

    const body = selected.map(s => {
      return `--- SKILL MANUAL: ${s.name} (${s.id}) ---\n${s.instructions || s.rawContent}`;
    }).join('\n\n');

    return header + body;
  }
};
