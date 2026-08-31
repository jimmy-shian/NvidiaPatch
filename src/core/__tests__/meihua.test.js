import { describe, it, expect } from 'vitest';
import { runMeihuaPipeline, calculateMeihua, resolveKnowledge, buildLLMContext } from '../meihua';

describe('Mobile Meihua Deterministic Pipeline', () => {
  it('should deterministically parse and calculate with 2 numbers in question', () => {
    const text = '我想詢問今年換工作是否合適 6, 8';
    const result = runMeihuaPipeline(text);

    expect(result.calculation.primary.hexagram.fullName).toBe('水地比');
    expect(result.calculation.primary.upper.name).toBe('坎');
    expect(result.calculation.primary.lower.name).toBe('坤');
    expect(result.calculation.primary.movingLine).toBe(2);
    expect(result.calculation.tiYong.relation).toBe('用剋體');
    expect(result.contextPayload).toContain('水地比');
    expect(result.contextPayload).toContain('用剋體');
  });

  it('should deterministically calculate time casting', () => {
    const fixedDate = new Date('2026-08-31T10:30:00');
    const result = runMeihuaPipeline('占運勢', { forceMethod: 'time', date: fixedDate });

    expect(result.calculation.method).toBe('time');
    expect(result.calculation.primary.upper).toBeDefined();
    expect(result.calculation.primary.lower).toBeDefined();
    expect(result.calculation.primary.movingLine).toBeGreaterThanOrEqual(1);
    expect(result.calculation.primary.movingLine).toBeLessThanOrEqual(6);
  });

  it('should deterministically parse and calculate with <meihua-numbers> special element', () => {
    const text = '<meihua-numbers n1="123" n2="456" n3="789"></meihua-numbers> 占問近期投資策略與運勢';
    const result = runMeihuaPipeline(text);

    expect(result.calculation.method).toBe('random');
    expect(result.calculation.randomNumbers).toEqual([123, 456, 789]);
    expect(result.parsedQuestion).toBe('占問近期投資策略與運勢');
    expect(result.contextPayload).toContain('【起卦方式】：隨機靈動數起卦（靈動數：123, 456, 789）');
    expect(result.contextPayload).toContain('【起卦時間】：');
    expect(result.calculation.primary.hexagram.fullName).toBeTruthy();
  });

  it('should default to time casting with built-in time prompt when no numbers are provided', () => {
    const fixedDate = new Date('2026-08-31T10:30:00');
    const text = '我是否應該在去看醫生?已經咳嗽7天以上了';
    const result = runMeihuaPipeline(text, { date: fixedDate });

    expect(result.calculation.method).toBe('time');
    expect(result.calculation.primary.hexagram.fullName).toBeTruthy();
    expect(result.calculation.tiYong.relation).toBeTruthy();
    expect(result.contextPayload).toContain('【梅花易數 確定性卦象計算與知識事實');
    expect(result.contextPayload).toContain('【起卦時間】：2026年8月31日 10:30（台北標準時間 UTC+8，內建即時時空背景）');
    expect(result.contextPayload).toContain('【起卦方式】：時間起卦（依當前年月日時干支數值推算）');
    expect(result.contextPayload).toContain(result.calculation.primary.hexagram.fullName);
  });
});
