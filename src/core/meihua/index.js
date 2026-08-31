import { calculateMeihua } from './calculator/index.js';
import { resolveKnowledge, buildLLMContext } from './resolver/knowledgeResolver.js';

export * from './calculator/index.js';
export * from './resolver/knowledgeResolver.js';

/**
 * 智慧解析使用者輸入並執行確定性梅花易數排盤
 * @param {string} rawInput 使用者原始輸入文字
 * @param {Object} options 選項 { forceMethod?: 'random'|'time'|'number', date?: Date }
 * @returns {{ calculation: Object, knowledge: Object, contextPayload: string, parsedQuestion: string }}
 */
export function runMeihuaPipeline(rawInput = '', options = {}) {
  const text = (rawInput || '').trim();
  let method = options.forceMethod || 'random';
  let a, b, moving;
  let question = text;

  // 1. 嘗試從文字中萃取數字 (例如 "6, 8", "123 456 789", "靈動數：38, 49")
  const numbersMatch = text.match(/\d+/g);

  if (options.forceMethod === 'time' || text.includes('當前時間') || text.includes('時間起卦')) {
    method = 'time';
    question = text.replace(/（?當前時間[^）]*）?/g, '').trim() || '當前時局與事態發展';
  } else if (options.forceMethod === 'random' || text.includes('隨機數字起卦') || text.includes('隨機起卦')) {
    method = 'random';
    question = text.replace(/（?隨機[^）]*）?/g, '').trim() || '綜合運勢與事態分析';
  } else if (numbersMatch && numbersMatch.length >= 2) {
    method = 'number';
    a = parseInt(numbersMatch[0], 10);
    b = parseInt(numbersMatch[1], 10);
    if (numbersMatch.length >= 3) {
      moving = parseInt(numbersMatch[2], 10);
    }
    // 移除純數字部分留下問題
    question = text.replace(/（?靈動數[：:]?[^）]*）?/g, '')
                   .replace(/[\d,，\s]+/g, ' ')
                   .trim() || '事態吉凶與發展走向';
  } else {
    // 未提供數字且非強制時間：採用隨機靈動數起卦
    method = 'random';
  }

  // 2. 確定性核心計算
  const calcResult = calculateMeihua({
    method,
    a,
    b,
    moving,
    date: options.date || new Date(),
    question: question || '事態發展與行動指引'
  });

  // 3. 關聯周易 64 卦 386 爻權威知識庫
  const resolved = resolveKnowledge(calcResult);

  // 4. 拼裝防幻覺 LLM 上下文
  const contextPayload = buildLLMContext(resolved, question);

  return {
    calculation: calcResult,
    knowledge: resolved.knowledge,
    contextPayload,
    parsedQuestion: question
  };
}
