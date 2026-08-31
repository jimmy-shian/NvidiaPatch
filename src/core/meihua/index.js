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
  let method = options.forceMethod || 'time';
  let a, b, moving;
  let question = text;
  let randomNumbers = null;

  // 1. 優先解析對話包裹元素 <meihua-numbers ...>
  const meihuaTagMatch = text.match(/<meihua-numbers\s+n1="(\d+)"\s+n2="(\d+)"\s+n3="(\d+)"[^>]*>/i) ||
                         text.match(/<meihua-numbers>(\d+)[,\s]+(\d+)[,\s]+(\d+)<\/meihua-numbers>/i);

  if (meihuaTagMatch) {
    method = 'random';
    a = parseInt(meihuaTagMatch[1], 10);
    b = parseInt(meihuaTagMatch[2], 10);
    moving = parseInt(meihuaTagMatch[3], 10);
    randomNumbers = [a, b, moving];
    // 清理標籤獲取純淨問題文本
    question = text.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '').trim() || '事態吉凶與發展走向';
  } else if (options.forceMethod === 'time' || text.includes('當前時間') || text.includes('時間起卦')) {
    method = 'time';
    question = text.replace(/（?當前時間[^）]*）?/g, '').trim() || '當前時局與事態發展';
  } else if (options.forceMethod === 'random' || text.includes('隨機數字起卦') || text.includes('隨機起卦')) {
    method = 'random';
    question = text.replace(/（?隨機[^）]*）?/g, '').trim() || '綜合運勢與事態分析';
  } else {
    // 檢查使用者是否手動在文字中輸入純數字 (例如 "6, 8", "123 456 789")
    const numbersMatch = text.match(/\d+/g);
    if (numbersMatch && numbersMatch.length >= 2) {
      method = 'number';
      a = parseInt(numbersMatch[0], 10);
      b = parseInt(numbersMatch[1], 10);
      if (numbersMatch.length >= 3) {
        moving = parseInt(numbersMatch[2], 10);
      }
      question = text.replace(/（?靈動數[：:]?[^）]*）?/g, '')
                     .replace(/[\d,，\s]+/g, ' ')
                     .trim() || '事態吉凶與發展走向';
    } else {
      // 未提供任何數字：預設採用「時間起卦」（內建即時時空背景與干支推算）
      method = 'time';
      question = text || '當前時局與事態發展';
    }
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

  if (randomNumbers) {
    calcResult.randomNumbers = randomNumbers;
  }

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
