import { describe, it, expect } from 'vitest';
import { HEXAGRAM_TABLE, lookupHexagram, getHexagramById } from '../calculator/hexagram.js';

describe('Meihua Hexagram Module', () => {
  it('should have all 64 hexagram entries in table', () => {
    const keys = Object.keys(HEXAGRAM_TABLE);
    expect(keys).toHaveLength(64);
  });

  it('should cover all upper and lower trigram combinations (8x8)', () => {
    for (let u = 1; u <= 8; u++) {
      for (let l = 1; l <= 8; l++) {
        const hex = lookupHexagram(u, l);
        expect(hex).toBeDefined();
        expect(hex.id).toBeGreaterThanOrEqual(1);
        expect(hex.id).toBeLessThanOrEqual(64);
        expect(hex.name).toBeTruthy();
        expect(hex.fullName).toBeTruthy();
      }
    }
  });

  it('should correctly lookup specific standard hexagrams', () => {
    // 乾上乾下 -> 乾為天 (1)
    expect(lookupHexagram(1, 1)?.fullName).toBe('乾為天');
    // 坎上坤下 -> 水地比 (8)
    expect(lookupHexagram(6, 8)?.fullName).toBe('水地比');
    // 乾上震下 -> 天雷無妄 (25)
    expect(lookupHexagram(1, 4)?.fullName).toBe('天雷無妄');
    // 離上坎下 -> 火水未濟 (64)
    expect(lookupHexagram(3, 6)?.fullName).toBe('火水未濟');
    // 坎上離下 -> 水火既濟 (63)
    expect(lookupHexagram(6, 3)?.fullName).toBe('水火既濟');
  });

  it('should find hexagram by King Wen id', () => {
    expect(getHexagramById(1)?.fullName).toBe('乾為天');
    expect(getHexagramById(64)?.fullName).toBe('火水未濟');
    expect(getHexagramById(25)?.fullName).toBe('天雷無妄');
  });
});
