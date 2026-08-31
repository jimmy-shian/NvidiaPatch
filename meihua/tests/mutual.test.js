import { describe, it, expect } from 'vitest';
import { calculateMutual } from '../calculator/mutual.js';

describe('Meihua Mutual Hexagram Module', () => {
  it('should correctly calculate mutual hexagram for standard cases', () => {
    // 天雷無妄: upper=乾[1,1,1], lower=震[1,0,0] -> lines = [1,0,0, 1,1,1] (bottom to top)
    // L1=1, L2=0, L3=0, L4=1, L5=1, L6=1
    // Lower mutual = [L2, L3, L4] = [0, 0, 1] = 艮 (7)
    // Upper mutual = [L3, L4, L5] = [0, 1, 1] = 巽 (5)
    // Upper 巽 (5) + Lower 艮 (7) = 風山漸 (53)
    const lines = [1, 0, 0, 1, 1, 1];
    const mutual = calculateMutual(lines);
    expect(mutual.lower).toBe(7); // 艮
    expect(mutual.upper).toBe(5); // 巽
    expect(mutual.hexagram.fullName).toBe('風山漸');
  });

  it('should keep Qian as Qian and Kun as Kun', () => {
    // 乾為天 lines = [1,1,1, 1,1,1]
    const qianLines = [1, 1, 1, 1, 1, 1];
    const qianMutual = calculateMutual(qianLines);
    expect(qianMutual.hexagram.fullName).toBe('乾為天');

    // 坤為地 lines = [0,0,0, 0,0,0]
    const kunLines = [0, 0, 0, 0, 0, 0];
    const kunMutual = calculateMutual(kunLines);
    expect(kunMutual.hexagram.fullName).toBe('坤為地');
  });
});
