import { describe, it, expect } from 'vitest';
import { TRIGRAMS, getTrigramById, getTrigramByName, trigramIdToBinary, binaryToTrigramId } from '../calculator/bagua.js';

describe('Meihua Bagua Module', () => {
  it('should have all 8 trigrams in correct Xiantian order', () => {
    expect(TRIGRAMS).toHaveLength(8);
    const names = TRIGRAMS.map(t => t.name);
    expect(names).toEqual(['乾', '兌', '離', '震', '巽', '坎', '艮', '坤']);
  });

  it('should correctly map binary to trigram id and vice versa', () => {
    // 乾: [1,1,1] -> 1
    expect(trigramIdToBinary(1)).toEqual([1, 1, 1]);
    expect(binaryToTrigramId([1, 1, 1])).toBe(1);

    // 坤: [0,0,0] -> 8
    expect(trigramIdToBinary(8)).toEqual([0, 0, 0]);
    expect(binaryToTrigramId([0, 0, 0])).toBe(8);

    // 坎: [0,1,0] -> 6
    expect(trigramIdToBinary(6)).toEqual([0, 1, 0]);
    expect(binaryToTrigramId([0, 1, 0])).toBe(6);

    // 離: [1,0,1] -> 3
    expect(trigramIdToBinary(3)).toEqual([1, 0, 1]);
    expect(binaryToTrigramId([1, 0, 1])).toBe(3);
  });

  it('should retrieve trigrams by name and id', () => {
    expect(getTrigramById(1)?.name).toBe('乾');
    expect(getTrigramByName('震')?.id).toBe(4);
    expect(getTrigramByName('巽')?.element).toBe('木');
    expect(getTrigramByName('離')?.element).toBe('火');
  });
});
