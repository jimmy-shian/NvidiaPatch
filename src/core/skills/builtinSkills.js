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
  { id: 'bazi', raw: baziContent, icon: '🏮', nameZh: '八字命理', nameEn: 'bazi-grandmaster' },
  { id: 'ziwei', raw: ziweiContent, icon: '🔮', nameZh: '紫微斗數', nameEn: 'ziwei-master' },
  { id: 'tarot', raw: tarotContent, icon: '🃏', nameZh: '經典塔羅', nameEn: 'tarot-master' },
  { id: 'qimen', raw: qimenContent, icon: '🧭', nameZh: '奇門遁甲', nameEn: 'qimen-grandmaster' },
  { id: 'meihua', raw: meihuaContent, icon: '🌸', nameZh: '梅花易數', nameEn: 'meihua-divination' },
  { id: 'liuyao', raw: liuyaoContent, icon: '🪙', nameZh: '六爻納甲', nameEn: 'liuyao-master' },
  { id: 'jingqian', raw: jingqianContent, icon: '📜', nameZh: '文王金錢卦', nameEn: 'jingqian-master' },
  { id: 'daily-fortune', raw: dailyFortuneContent, icon: '☀️', nameZh: '每日運勢', nameEn: 'daily-fortune' },
  { id: 'dream', raw: dreamContent, icon: '💭', nameZh: '周公解夢', nameEn: 'dream-interpreter' },
  { id: 'naming', raw: namingContent, icon: '📝', nameZh: '生辰八字取名', nameEn: 'naming-master' }
];

export const BUILTIN_SKILLS = rawSkills.map(s => {
  const parsed = parseSkillMarkdown(s.raw, s.id);
  return {
    ...parsed,
    id: s.id,
    nameZh: s.nameZh || parsed.nameZh,
    nameEn: s.nameEn || parsed.nameEn || parsed.name,
    name: s.nameZh || parsed.name,
    icon: s.icon,
    isBuiltin: true
  };
});
