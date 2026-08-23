import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown } from '../skills/skillParser';

describe('Skill Parser', () => {
  it('parses markdown with YAML frontmatter correctly', () => {
    const raw = `---
name: bazi-grandmaster
description: Bazi Destiny Analysis System
icon: 🏮
tools_required: [web_search, web_fetch]
---

# Bazi Instructions
Operate as a Grandmaster.`;

    const parsed = parseSkillMarkdown(raw, 'fallback-id');
    expect(parsed).not.toBeNull();
    expect(parsed.id).toBe('bazi-grandmaster');
    expect(parsed.name).toBe('bazi-grandmaster');
    expect(parsed.description).toBe('Bazi Destiny Analysis System');
    expect(parsed.icon).toBe('🏮');
    expect(parsed.toolsRequired).toEqual(['web_search', 'web_fetch']);
    expect(parsed.instructions).toContain('# Bazi Instructions');
  });

  it('handles markdown without frontmatter gracefully', () => {
    const raw = '# Custom Prompt\nAnswer all queries as a pirate.';
    const parsed = parseSkillMarkdown(raw, 'pirate-mode');
    expect(parsed).not.toBeNull();
    expect(parsed.id).toBe('pirate-mode');
    expect(parsed.instructions).toBe(raw);
  });
});
