/**
 * Built-in initial skills preloaded in Mobile App
 * (Derived from repository skills/ library)
 */
import baziContent from '../../../skills/bazi/SKILL.md?raw';
import ziweiContent from '../../../skills/ziwei/SKILL.md?raw';
import tarotContent from '../../../skills/tarot/SKILL.md?raw';
import qimenContent from '../../../skills/qimen/SKILL.md?raw';
import meihuaContent from '../../../skills/meihua/SKILL.md?raw';
import { parseSkillMarkdown } from './skillParser';

const rawSkills = [
  { id: 'bazi', raw: baziContent, icon: '🏮' },
  { id: 'ziwei', raw: ziweiContent, icon: '🔮' },
  { id: 'tarot', raw: tarotContent, icon: '🃏' },
  { id: 'qimen', raw: qimenContent, icon: '🧭' },
  { id: 'meihua', raw: meihuaContent, icon: '🌸' }
];

export const BUILTIN_SKILLS = rawSkills.map(s => {
  const parsed = parseSkillMarkdown(s.raw, s.id);
  return {
    ...parsed,
    id: s.id,
    icon: s.icon,
    isBuiltin: true
  };
});
