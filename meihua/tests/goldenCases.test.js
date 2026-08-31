import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateMeihua } from '../calculator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Meihua Golden Cases Verification', () => {
  const goldenCasesRaw = fs.readFileSync(path.join(__dirname, 'golden_cases.json'), 'utf-8');
  const goldenCases = JSON.parse(goldenCasesRaw);

  goldenCases.forEach((testCase, idx) => {
    it(`Case ${idx + 1}: ${testCase.description}`, () => {
      const result = calculateMeihua(testCase.input);

      expect(result.primary.upper.name).toBe(testCase.expected.primary.upper);
      expect(result.primary.lower.name).toBe(testCase.expected.primary.lower);
      expect(result.primary.hexagram.fullName).toBe(testCase.expected.primary.fullName);
      expect(result.primary.movingLine).toBe(testCase.expected.movingLine);

      expect(result.mutual.upper.name).toBe(testCase.expected.mutual.upper);
      expect(result.mutual.lower.name).toBe(testCase.expected.mutual.lower);
      expect(result.mutual.hexagram.fullName).toBe(testCase.expected.mutual.fullName);

      expect(result.changed.upper.name).toBe(testCase.expected.changed.upper);
      expect(result.changed.lower.name).toBe(testCase.expected.changed.lower);
      expect(result.changed.hexagram.fullName).toBe(testCase.expected.changed.fullName);

      expect(result.tiYong.ti.trigram.name).toBe(testCase.expected.ti.name);
      expect(result.tiYong.ti.position).toBe(testCase.expected.ti.position);
      expect(result.tiYong.yong.trigram.name).toBe(testCase.expected.yong.name);
      expect(result.tiYong.yong.position).toBe(testCase.expected.yong.position);
      expect(result.tiYong.relation).toBe(testCase.expected.relation);
    });
  });
});
