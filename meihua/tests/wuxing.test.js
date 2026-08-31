import { describe, it, expect } from 'vitest';
import { getElementRelation } from '../calculator/wuxing.js';

describe('Meihua Wuxing Module', () => {
  it('should correctly determine all 5 relational classes', () => {
    // Same -> 比和
    expect(getElementRelation('木', '木')).toBe('比和');
    expect(getElementRelation('金', '金')).toBe('比和');

    // Yong generates Ti -> 用生體 (Water generates Wood, Yong=Water, Ti=Wood)
    expect(getElementRelation('木', '水')).toBe('用生體');
    // Earth generates Metal, Yong=Earth, Ti=Metal
    expect(getElementRelation('金', '土')).toBe('用生體');

    // Ti generates Yong -> 體生用 (Wood generates Fire, Ti=Wood, Yong=Fire)
    expect(getElementRelation('木', '火')).toBe('體生用');
    // Metal generates Water, Ti=Metal, Yong=Water
    expect(getElementRelation('金', '水')).toBe('體生用');

    // Yong overcomes Ti -> 用剋體 (Metal overcomes Wood, Yong=Metal, Ti=Wood)
    expect(getElementRelation('木', '金')).toBe('用剋體');
    // Water overcomes Fire, Yong=Water, Ti=Fire
    expect(getElementRelation('火', '水')).toBe('用剋體');

    // Ti overcomes Yong -> 體剋用 (Wood overcomes Earth, Ti=Wood, Yong=Earth)
    expect(getElementRelation('木', '土')).toBe('體剋用');
    // Fire overcomes Metal, Ti=Fire, Yong=Metal
    expect(getElementRelation('火', '金')).toBe('體剋用');
  });
});
