import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ChatInput from '../ChatInput';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, fallback) => fallback || key
  })
}));

describe('ChatInput Priority Skills and Expand Functionality', () => {
  const mockSkills = [
    { id: 'bazi', name: '八字命理', icon: '🏮', description: '八字分析' },
    { id: 'ziwei', name: '紫微斗數', icon: '🌌', description: '紫微命盤' },
    { id: 'tarot', name: '經典塔羅', icon: '🃏', description: '塔羅占卜' },
    { id: 'qimen', name: '奇門遁甲', icon: '🧭', description: '奇門決策' },
    { id: 'liuyao', name: '六爻納甲', icon: '🪙', description: '六爻推算' },
    { id: 'meihua', name: '梅花易數', icon: '🌸', description: '專屬占卜' }
  ];

  it('renders top 4 skills as priority quick chips and shows expand button for remaining skills', () => {
    const html = renderToString(
      React.createElement(ChatInput, {
        input: '',
        setInput: () => {},
        isStreaming: false,
        onSend: () => {},
        onStop: () => {},
        availableSkills: mockSkills,
        selectedSkillIds: [],
        onToggleSkill: () => {},
        disabled: false
      })
    );

    // Top 4 skills should be directly rendered
    expect(html).toContain('八字命理');
    expect(html).toContain('紫微斗數');
    expect(html).toContain('經典塔羅');
    expect(html).toContain('奇門遁甲');

    // 'meihua' is filtered out from general chat skills
    expect(html).not.toContain('🌸');

    // 5th skill 'liuyao' should NOT be in the default unexpanded chips
    // It should have an expand button with count "(+1)" (since liuyao is the 1 remaining skill)
    expect(html).toContain('更多 (+1)');
  });

  it('displays non-priority skill in chips when it is selected', () => {
    const html = renderToString(
      React.createElement(ChatInput, {
        input: '',
        setInput: () => {},
        isStreaming: false,
        onSend: () => {},
        onStop: () => {},
        availableSkills: mockSkills,
        selectedSkillIds: ['liuyao'], // 5th skill is selected
        onToggleSkill: () => {},
        disabled: false
      })
    );

    // Should include liuyao in chips because it's actively selected
    expect(html).toContain('六爻納甲');
    expect(html).toContain('清除勾選');
    expect(html).toMatch(/清除勾選\s*\(.*1.*\)/);
  });
});
