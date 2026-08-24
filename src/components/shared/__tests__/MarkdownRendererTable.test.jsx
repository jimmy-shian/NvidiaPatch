import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderContentWithLineBreaks } from '../MarkdownRenderer';

describe('Markdown Table & Line Break Transformer', () => {
  it('converts literal <br>, <br/>, <br /> strings into React <br /> elements', () => {
    const raw = '神：玄武<br>星：天英<br/>門：死門<br />干：癸 / 丙';
    const transformed = renderContentWithLineBreaks(raw);

    expect(Array.isArray(transformed)).toBe(true);
    // Split into 4 parts separated by 3 <br /> elements
    expect(transformed).toHaveLength(4);
    expect(transformed[0].props.children).toContain('神：玄武');
    expect(transformed[1].props.children).toBeDefined();
  });

  it('preserves ordinary strings without <br> tags untouched', () => {
    const raw = '單純文字內容，無任何換行標籤';
    const result = renderContentWithLineBreaks(raw);
    expect(result).toBe(raw);
  });

  it('recursively processes nested array of children', () => {
    const nested = ['前段文字', '<br>', '後段文字'];
    const result = renderContentWithLineBreaks(nested);
    expect(result).toHaveLength(3);
  });
});
