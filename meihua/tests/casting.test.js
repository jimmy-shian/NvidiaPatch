import { describe, it, expect } from 'vitest';
import { numberCasting, timeCasting, randomCasting } from '../calculator/casting.js';

describe('Meihua Casting Module', () => {
  it('should correctly cast with 2 numbers', () => {
    // a=6, b=8 -> upper=6 (坎), lower=8 (坤), moving=(6+8)%6 = 14%6 = 2
    const res = numberCasting({ a: 6, b: 8 });
    expect(res.upper).toBe(6);
    expect(res.lower).toBe(8);
    expect(res.movingLine).toBe(2);
  });

  it('should correctly handle remainder 0 mapping to 8 for trigrams and 6 for moving lines', () => {
    // a=8, b=16, moving=12 -> upper=8, lower=8, moving=6
    const res = numberCasting({ a: 8, b: 16, moving: 12 });
    expect(res.upper).toBe(8);
    expect(res.lower).toBe(8);
    expect(res.movingLine).toBe(6);
  });

  it('should correctly handle 3 numbers with moving line provided', () => {
    // a=1, b=3, moving=5 -> upper=1 (乾), lower=3 (離), moving=5
    const res = numberCasting({ a: 1, b: 3, moving: 5 });
    expect(res.upper).toBe(1);
    expect(res.lower).toBe(3);
    expect(res.movingLine).toBe(5);
  });

  it('should generate valid time casting from fixed date', () => {
    const fixedDate = new Date('2026-08-31T10:30:00');
    const res = timeCasting(fixedDate);
    expect(res.upper).toBeGreaterThanOrEqual(1);
    expect(res.upper).toBeLessThanOrEqual(8);
    expect(res.lower).toBeGreaterThanOrEqual(1);
    expect(res.lower).toBeLessThanOrEqual(8);
    expect(res.movingLine).toBeGreaterThanOrEqual(1);
    expect(res.movingLine).toBeLessThanOrEqual(6);
  });

  it('should generate valid random casting', () => {
    const res = randomCasting();
    expect(res.upper).toBeGreaterThanOrEqual(1);
    expect(res.upper).toBeLessThanOrEqual(8);
    expect(res.lower).toBeGreaterThanOrEqual(1);
    expect(res.lower).toBeLessThanOrEqual(8);
    expect(res.movingLine).toBeGreaterThanOrEqual(1);
    expect(res.movingLine).toBeLessThanOrEqual(6);
    expect(res.randomNumbers).toHaveLength(3);
  });
});
