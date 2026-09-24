import { describe, it, expect } from 'vitest';
import { executeCalculator, evaluateExpression } from '../local/calculator';
import { executeDateCalculator, parseDateString } from '../local/dateCalc';
import { executeUnitConverter } from '../local/unitConvert';
import { executeDateTimeNow, getShichen, getNextSolarTerm } from '../local/dateTime';
import { executeRandomDraw } from '../local/randomDraw';
import { executeTool, SYSTEM_TOOLS } from '../index';

describe('Local Tools Extension', () => {
  describe('System Tools Registration', () => {
    it('registers all 5 local tools in SYSTEM_TOOLS', () => {
      const toolNames = SYSTEM_TOOLS.map(t => t.function.name);
      expect(toolNames).toContain('calculator');
      expect(toolNames).toContain('date_calculator');
      expect(toolNames).toContain('unit_converter');
      expect(toolNames).toContain('datetime_now');
      expect(toolNames).toContain('random_draw');
    });
  });

  describe('Calculator Tool (Safe Deterministic Evaluator)', () => {
    it('handles basic arithmetic with operator precedence', () => {
      expect(evaluateExpression('1 + 2 * 3')).toBe(7);
      expect(evaluateExpression('(1 + 2) * 3')).toBe(9);
      expect(evaluateExpression('10 - 4 / 2')).toBe(8);
      expect(evaluateExpression('2 ^ 3 + 1')).toBe(9);
    });

    it('handles unary minus and decimals', () => {
      expect(evaluateExpression('-5 + 10')).toBe(5);
      expect(evaluateExpression('3 * -2')).toBe(-6);
      expect(evaluateExpression('0.5 * 4')).toBe(2);
    });

    it('handles math functions and constants', () => {
      expect(evaluateExpression('sqrt(16) + abs(-5)')).toBe(9);
      expect(evaluateExpression('round(pi * 100)')).toBe(314);
      expect(evaluateExpression('log(100)')).toBe(2);
      expect(evaluateExpression('ln(e)')).toBe(1);
    });

    it('defends against division by zero', () => {
      const res = executeCalculator({ expression: '10 / 0' });
      expect(res.isError).toBe(true);
      expect(res.error).toContain('除數不能為零');
    });

    it('defends against malicious code or keywords', () => {
      const res = executeCalculator({ expression: 'while(1) {}' });
      expect(res.isError).toBe(true);
      expect(res.error).toContain('拒絕包含潛在危險關鍵字');
    });

    it('dispatches via executeTool', async () => {
      const res = await executeTool('calculator', { expression: '12 * 12' });
      expect(res.success).toBe(true);
      expect(res.result).toBe(144);
    });
  });

  describe('Date Calculator Tool', () => {
    it('calculates date differences in days', () => {
      const res = executeDateCalculator({
        operation: 'diff',
        date: '2024-01-01',
        targetDate: '2024-01-11'
      });
      expect(res.success).toBe(true);
      expect(res.diffDays).toBe(10);
    });

    it('adds and subtracts days, months, and years', () => {
      const res = executeDateCalculator({
        operation: 'add_subtract',
        date: '2024-01-01',
        days: 15
      });
      expect(res.success).toBe(true);
      expect(res.resultDate).toBe('2024-01-16');
    });

    it('queries day of the week', () => {
      // 2024-01-01 was Monday
      const res = executeDateCalculator({
        operation: 'day_of_week',
        date: '2024-01-01'
      });
      expect(res.success).toBe(true);
      expect(res.weekday).toBe('星期一');
    });

    it('calculates age in years and total lived days', () => {
      const res = executeDateCalculator({
        operation: 'age',
        date: '2000-01-01'
      });
      expect(res.success).toBe(true);
      expect(res.ageYears).toBeGreaterThanOrEqual(24);
      expect(res.totalDaysLived).toBeGreaterThan(8000);
    });

    it('handles countdown to future date', () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);
      const y = future.getFullYear();
      const m = String(future.getMonth() + 1).padStart(2, '0');
      const d = String(future.getDate()).padStart(2, '0');

      const res = executeDateCalculator({
        operation: 'countdown',
        date: `${y}-${m}-${d}`
      });
      expect(res.success).toBe(true);
      expect(res.daysRemaining).toBe(10);
    });

    it('rejects invalid date formats', () => {
      const res = executeDateCalculator({
        operation: 'diff',
        date: 'invalid-date',
        targetDate: '2024-01-01'
      });
      expect(res.isError).toBe(true);
    });
  });

  describe('Unit Converter Tool', () => {
    it('converts lengths (metric and imperial and Taiwanese)', () => {
      const res1 = executeUnitConverter({ value: 100, fromUnit: 'cm', toUnit: 'm' });
      expect(res1.success).toBe(true);
      expect(res1.result).toBe(1);

      const res2 = executeUnitConverter({ value: 1, fromUnit: 'km', toUnit: 'meter' });
      expect(res2.result).toBe(1000);

      const res3 = executeUnitConverter({ value: 3.3, fromUnit: '台尺', toUnit: 'm' });
      expect(res3.success).toBe(true);
      expect(Math.abs(res3.result - 1)).toBeLessThan(0.01);
    });

    it('converts weights including Taiwanese jin and liang', () => {
      const res1 = executeUnitConverter({ value: 1, fromUnit: '台斤', toUnit: 'g' });
      expect(res1.result).toBe(600);

      const res2 = executeUnitConverter({ value: 1, fromUnit: '台斤', toUnit: '兩' });
      expect(res2.result).toBe(16);

      const res3 = executeUnitConverter({ value: 1, fromUnit: 'kg', toUnit: 'g' });
      expect(res3.result).toBe(1000);
    });

    it('converts area including ping and jia', () => {
      const res1 = executeUnitConverter({ value: 1, fromUnit: '坪', toUnit: 'm2' });
      expect(res1.success).toBe(true);
      expect(Math.abs(res1.result - 3.305785)).toBeLessThan(0.01);

      const res2 = executeUnitConverter({ value: 1, fromUnit: '甲', toUnit: 'm2' });
      expect(res2.success).toBe(true);
      expect(Math.abs(res2.result - 9699.17)).toBeLessThan(1);
    });

    it('converts temperatures (Celsius, Fahrenheit, Kelvin)', () => {
      const res1 = executeUnitConverter({ value: 0, fromUnit: 'C', toUnit: 'F' });
      expect(res1.result).toBe(32);

      const res2 = executeUnitConverter({ value: 100, fromUnit: 'C', toUnit: 'F' });
      expect(res2.result).toBe(212);

      const res3 = executeUnitConverter({ value: 0, fromUnit: 'C', toUnit: 'K' });
      expect(res3.result).toBe(273.15);
    });

    it('explicitly refuses currency conversion and guides to web_search', () => {
      const res = executeUnitConverter({ value: 100, fromUnit: 'USD', toUnit: 'TWD' });
      expect(res.isError).toBe(true);
      expect(res.error).toContain('web_search');
    });
  });

  describe('DateTime Now Tool', () => {
    it('returns current time and double-hour (時辰)', () => {
      const res = executeDateTimeNow();
      expect(res.success).toBe(true);
      expect(res.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(res.shichen).toBeDefined();
      expect(res.shichen.branch).toBeDefined();
      expect(res.shichen.animal).toBeDefined();
    });

    it('determines correct shichen for hours', () => {
      expect(getShichen(23).name).toBe('子時');
      expect(getShichen(0).name).toBe('子時');
      expect(getShichen(12).name).toBe('午時');
      expect(getShichen(8).name).toBe('辰時');
    });

    it('calculates the next solar term', () => {
      const next = getNextSolarTerm(new Date(2024, 0, 1));
      expect(next).not.toBeNull();
      expect(next.name).toBe('小寒');
      expect(next.daysAway).toBeGreaterThan(0);
    });
  });

  describe('Random Draw Tool', () => {
    it('generates 3 meihua seed numbers between 1 and 999', () => {
      const res = executeRandomDraw({ mode: 'meihua_numbers' });
      expect(res.success).toBe(true);
      expect(res.numbers).toHaveLength(3);
      res.numbers.forEach(n => {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(999);
      });
    });

    it('draws random numbers within range', () => {
      const res = executeRandomDraw({ mode: 'range', min: 10, max: 20, count: 5 });
      expect(res.success).toBe(true);
      expect(res.results).toHaveLength(5);
      res.results.forEach(n => {
        expect(n).toBeGreaterThanOrEqual(10);
        expect(n).toBeLessThanOrEqual(20);
      });
    });

    it('rolls dice with given sides and count', () => {
      const res = executeRandomDraw({ mode: 'dice', sides: 6, count: 3 });
      expect(res.success).toBe(true);
      expect(res.rolls).toHaveLength(3);
      expect(res.total).toBe(res.rolls.reduce((a, b) => a + b, 0));
    });

    it('draws items from options list without replacement by default', () => {
      const options = ['A', 'B', 'C', 'D'];
      const res = executeRandomDraw({ mode: 'draw', options, count: 2 });
      expect(res.success).toBe(true);
      expect(res.drawn).toHaveLength(2);
      expect(options).toContain(res.drawn[0]);
      expect(options).toContain(res.drawn[1]);
      expect(res.drawn[0]).not.toBe(res.drawn[1]);
    });
  });
});
