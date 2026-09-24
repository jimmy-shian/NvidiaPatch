/**
 * Built-in initial skills preloaded in Mobile App
 * (Derived from repository skills/ library)
 */
import baziContent from '../../../skills/bazi/SKILL.md?raw';
import ziweiContent from '../../../skills/ziwei/SKILL.md?raw';
import tarotContent from '../../../skills/tarot/SKILL.md?raw';
import qimenContent from '../../../skills/qimen/SKILL.md?raw';
import meihuaContent from '../../../skills/meihua/SKILL.md?raw';
import liuyaoContent from '../../../skills/liuyao/SKILL.md?raw';
import jingqianContent from '../../../skills/jingqian/SKILL.md?raw';
import dailyFortuneContent from '../../../skills/daily-fortune/SKILL.md?raw';
import dreamContent from '../../../skills/dream/SKILL.md?raw';
import namingContent from '../../../skills/naming/SKILL.md?raw';
import { parseSkillMarkdown } from './skillParser';

const rawSkills = [
  { id: 'bazi', raw: baziContent, icon: '🏮' },
  { id: 'ziwei', raw: ziweiContent, icon: '🔮' },
  { id: 'tarot', raw: tarotContent, icon: '🃏' },
  { id: 'qimen', raw: qimenContent, icon: '🧭' },
  { id: 'meihua', raw: meihuaContent, icon: '🌸' },
  { id: 'liuyao', raw: liuyaoContent, icon: '🪙' },
  { id: 'jingqian', raw: jingqianContent, icon: '📜' },
  { id: 'daily-fortune', raw: dailyFortuneContent, icon: '☀️' },
  { id: 'dream', raw: dreamContent, icon: '💭' },
  { id: 'naming', raw: namingContent, icon: '📝' }
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
