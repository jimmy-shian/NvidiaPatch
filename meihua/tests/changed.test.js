import { describe, it, expect } from 'vitest';
import { calculateChanged } from '../calculator/changed.js';

describe('Meihua Changed Hexagram Module', () => {
  it('should correctly flip single bit for each moving line', () => {
    // 乾為天 [1,1,1, 1,1,1]
    const qianLines = [1, 1, 1, 1, 1, 1];

    // Moving line 1: L1 flips 1->0 -> [0,1,1, 1,1,1] = lower 巽(5), upper 乾(1) = 天風姤 (44)
    const ch1 = calculateChanged(qianLines, 1);
    expect(ch1.lines).toEqual([0, 1, 1, 1, 1, 1]);
    expect(ch1.lower).toBe(5);
    expect(ch1.upper).toBe(1);
    expect(ch1.hexagram.fullName).toBe('天風姤');

    // Moving line 2: L2 flips 1->0 -> [1,0,1, 1,1,1] = lower 離(3), upper 乾(1) = 天火同人 (13)
    const ch2 = calculateChanged(qianLines, 2);
    expect(ch2.lower).toBe(3);
    expect(ch2.upper).toBe(1);
    expect(ch2.hexagram.fullName).toBe('天火同人');

    // Moving line 6: L6 flips 1->0 -> [1,1,1, 1,1,0] = lower 乾(1), upper 兌(2) = 澤天夬 (43)
    const ch6 = calculateChanged(qianLines, 6);
    expect(ch6.lower).toBe(1);
    expect(ch6.upper).toBe(2);
    expect(ch6.hexagram.fullName).toBe('澤天夬');
  });
});
