import baziSkillRaw from './divinationSkills/baziSkill.md?raw';
import ziweiSkillRaw from './divinationSkills/ziweiSkill.md?raw';
import tarotSkillRaw from './divinationSkills/tarotSkill.md?raw';

export const DIVINATION_SKILLS = [
  {
    id: 'bazi',
    label: '八字 Grandmaster',
    labelEn: 'Bazi',
    icon: '🏮',
    shortDesc: '四柱命理 · 十八大子系統',
    content: baziSkillRaw,
  },
  {
    id: 'ziwei',
    label: '紫微斗數 Grandmaster',
    labelEn: 'Ziwei Doushu',
    icon: '🔮',
    shortDesc: '十二宮 · 十大子系統',
    content: ziweiSkillRaw,
  },
  {
    id: 'tarot',
    label: '塔羅 Grandmaster',
    labelEn: 'Tarot',
    icon: '🃏',
    shortDesc: '78 牌 · 十大子系統',
    content: tarotSkillRaw,
  },
];

export function buildSkillSystemMessage(selectedSkillIds) {
  if (!selectedSkillIds || selectedSkillIds.length === 0) return null;

  const selected = DIVINATION_SKILLS.filter((s) => selectedSkillIds.includes(s.id));

  if (selected.length === 0) return null;

  const header =
    selected.length === 1
      ? `You are now operating under the ${selected[0].label} skill. Follow the instructions in the skill manual below precisely. Activate all 10 sub-systems silently, then present a comprehensive analysis.\n\n`
      : `You are now operating under ${selected.length} divination skills simultaneously. Follow all skill manuals below. Cross-reference insights across traditions where applicable. Present a unified, multi-disciplinary comprehensive analysis.\n\n`;

  const body = selected
    .map((s) => `=== ${s.label} (${s.labelEn}) ===\n${s.content}`)
    .join('\n\n');

  return header + body;
}
