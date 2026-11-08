import { describe, it, expect } from 'vitest';
import { extractCleanQuery, formatToolProgressSummary } from '../toolDisplayHelper';

describe('toolDisplayHelper', () => {
  it('extracts clean query from json string or object without raw braces', () => {
    expect(extractCleanQuery('{"query": "紫微斗數 財運"}')).toBe('紫微斗數 財運');
    expect(extractCleanQuery({ query: '塔羅牌 牌義' })).toBe('塔羅牌 牌義');
    expect(extractCleanQuery('{"model": "test"}')).toBe('');
    expect(extractCleanQuery(null)).toBe('');
  });

  it('formats cloud search completed progress with meaningful result count', () => {
    const summary = formatToolProgressSummary({
      toolName: 'web_search',
      status: 'completed',
      args: { query: '紫微斗數' },
      result: {
        effectiveProvider: 'worker_cf',
        results: [{ title: 'A' }, { title: 'B' }, { title: 'C' }]
      }
    });

    expect(summary.title).toContain('雲端搜尋完成');
    expect(summary.title).toContain('3 筆結果');
    expect(summary.detail).toBe('"紫微斗數"');
    expect(summary.isCloud).toBe(true);
  });

  it('formats multi-round search with batch labels cleanly', () => {
    const summary1 = formatToolProgressSummary({
      toolName: 'web_search',
      status: 'completed',
      args: { query: '輪次1' },
      result: { count: 10 },
      index: 0,
      totalSearchCalls: 2
    });
    expect(summary1.title).toContain('第 1 輪');
    expect(summary1.title).toContain('10 筆');
  });

  it('handles executing search state with clean query or placeholder', () => {
    const executingSummary = formatToolProgressSummary({
      toolName: 'web_search',
      status: 'executing',
      args: { query: '即時天氣' }
    });
    expect(executingSummary.isExecuting).toBe(true);
    expect(executingSummary.title).toContain('正在搜尋相關資料');
    expect(executingSummary.detail).toBe('"即時天氣"');
  });
});
