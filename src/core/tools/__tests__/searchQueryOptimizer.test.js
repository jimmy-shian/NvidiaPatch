import { describe, it, expect } from 'vitest';
import {
  generateQueryFingerprint,
  relaxQuery,
  extractCoreKeywords
} from '../search/searchQueryOptimizer';

describe('Search Query Optimizer', () => {
  it('generates consistent fingerprints for deduplication', () => {
    const fp1 = generateQueryFingerprint('  NVIDIA   Blackwell 2026!  ');
    const fp2 = generateQueryFingerprint('nvidia blackwell 2026');
    expect(fp1).toBe(fp2);
    expect(fp1).toBe('nvidia blackwell 2026');
  });

  it('relaxes query by removing conversational filler while strictly preserving dates, model identifiers, and entities', () => {
    const rawQuery = '請幫我查詢 NVIDIA RTX 5090 2026-08-24 的最新消息';
    const relaxed = relaxQuery(rawQuery);

    expect(relaxed).toContain('NVIDIA');
    expect(relaxed).toContain('RTX 5090');
    expect(relaxed).toContain('2026-08-24');
    expect(relaxed).not.toContain('請幫我查詢');
  });

  it('removes search operator punctuation in relaxed query without destroying terms', () => {
    const raw = 'site:nvidia.com (Blackwell architecture) AND "release date"';
    const relaxed = relaxQuery(raw);

    expect(relaxed).toContain('Blackwell architecture');
    expect(relaxed).toContain('release date');
    expect(relaxed).not.toContain('site:');
    expect(relaxed).not.toContain('AND');
  });

  it('extracts core keywords with date and entity prioritization', () => {
    const query = '請查詢 台灣 2026年 8月 台北市 的 即時氣溫 降雨機率 報告';
    const core = extractCoreKeywords(query);

    expect(core).toBeDefined();
    expect(core.split(' ').length).toBeLessThanOrEqual(4);
    expect(core).toMatch(/2026|台灣|台北市/);
  });
});
