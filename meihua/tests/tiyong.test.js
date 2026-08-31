import { describe, it, expect } from 'vitest';
import { determineTiYong } from '../calculator/tiyong.js';

describe('Meihua Ti-Yong Module', () => {
  it('should set lower as Yong and upper as Ti when moving line is 1, 2, or 3', () => {
    // Upper: 乾(1), Lower: 震(4), moving line 2
    const res = determineTiYong(1, 4, 2);
    expect(res.ti.position).toBe('upper');
    expect(res.ti.trigram.name).toBe('乾');
    expect(res.yong.position).toBe('lower');
    expect(res.yong.trigram.name).toBe('震');
  });

  it('should set upper as Yong and lower as Ti when moving line is 4, 5, or 6', () => {
    // Upper: 乾(1), Lower: 震(4), moving line 5
    const res = determineTiYong(1, 4, 5);
    expect(res.ti.position).toBe('lower');
    expect(res.ti.trigram.name).toBe('震');
    expect(res.yong.position).toBe('upper');
    expect(res.yong.trigram.name).toBe('乾');
  });
});
