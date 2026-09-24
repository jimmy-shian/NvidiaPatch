import { describe, it, expect, beforeEach } from 'vitest';
import { SkillManager } from '../skillManager';
import { LocalDB } from '../../storage/localDatabase';

describe('SkillManager display ordering', () => {
  beforeEach(async () => {
    // Reset any stored display order before each test
    await LocalDB.saveContextSetting('skills_display_order', []);
  });

  it('saves and retrieves skill display order correctly', async () => {
    const customOrder = ['liuyao', 'tarot', 'dream', 'bazi'];
    await SkillManager.saveSkillsOrder(customOrder);

    const savedOrder = await SkillManager.getSkillsOrder();
    expect(savedOrder).toEqual(customOrder);
  });

  it('returns all skills sorted according to custom display order', async () => {
    const customOrder = ['naming', 'dream', 'daily-fortune'];
    await SkillManager.saveSkillsOrder(customOrder);

    const allSkills = await SkillManager.getAllSkills();
    expect(allSkills.length).toBeGreaterThan(3);

    // The first three skills must follow the custom order
    expect(allSkills[0].id).toBe('naming');
    expect(allSkills[1].id).toBe('dream');
    expect(allSkills[2].id).toBe('daily-fortune');

    // The remaining skills should still be included
    const remainingIds = allSkills.slice(3).map(s => s.id);
    expect(remainingIds).toContain('bazi');
    expect(remainingIds).toContain('ziwei');
    expect(remainingIds).toContain('tarot');
  });

  it('handles empty or non-array display orders gracefully', async () => {
    await SkillManager.saveSkillsOrder(null);
    const orderNull = await SkillManager.getSkillsOrder();
    expect(orderNull).toEqual([]);

    const allSkills = await SkillManager.getAllSkills();
    expect(Array.isArray(allSkills)).toBe(true);
    expect(allSkills.length).toBeGreaterThan(0);
  });
});
