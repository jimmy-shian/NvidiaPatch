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

describe('ChatInput Compact Skills Selector and Filter Functionality', () => {
  const mockSkills = [
    { id: 'bazi', name: '八字命理', icon: '🏮', description: '八字分析' },
    { id: 'ziwei', name: '紫微斗數', icon: '🌌', description: '紫微命盤' },
    { id: 'tarot', name: '經典塔羅', icon: '🃏', description: '塔羅占卜' },
    { id: 'qimen', name: '奇門遁甲', icon: '🧭', description: '奇門決策' },
    { id: 'liuyao', name: '六爻納甲', icon: '🪙', description: '六爻推算' },
    { id: 'meihua', name: '梅花易數', icon: '🌸', description: '專屬占卜' }
  ];

  it('renders compact collapsed skill selector button without cluttering input area', () => {
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

    // Collapsed toggle button should be rendered
    expect(html).toContain('技能（已選擇 0）');

    // 'meihua' is filtered out from general chat skills
    expect(html).not.toContain('🌸');
    expect(html).not.toContain('梅花易數');
  });

  it('updates selection count badge and shows clear button when skills are selected', () => {
    const html = renderToString(
      React.createElement(ChatInput, {
        input: '',
        setInput: () => {},
        isStreaming: false,
        onSend: () => {},
        onStop: () => {},
        availableSkills: mockSkills,
        selectedSkillIds: ['bazi', 'ziwei'],
        onToggleSkill: () => {},
        disabled: false
      })
    );

    // Should indicate 2 skills selected
    expect(html).toContain('技能（已選擇 2）');
    // Should provide clear selection button
    expect(html).toContain('清除勾選 (2)');
  });
});
