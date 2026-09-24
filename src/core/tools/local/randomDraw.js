/**
 * Random Draw, Dice, and Meihua Seed Numbers Tool
 */

export const RANDOM_DRAW_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'random_draw',
    description: '隨機抽籤、擲骰子、數值區間隨機選取或生成梅花易數三位靈動數 (1-999)。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['meihua_numbers', 'range', 'dice', 'draw'],
          description: '模式：meihua_numbers (梅花易數三位靈動數), range (整數區間), dice (擲骰子), draw (自訂清單抽籤)'
        },
        min: {
          type: 'number',
          description: '區間最小值 (用於 range)'
        },
        max: {
          type: 'number',
          description: '區間最大值 (用於 range)'
        },
        count: {
          type: 'number',
          description: '抽取數量 (預設 1)'
        },
        sides: {
          type: 'number',
          description: '骰子面數 (用於 dice，預設 6)'
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '候選選項陣列 (用於 draw 抽籤)'
        },
        allowReplacement: {
          type: 'boolean',
          description: '是否放回重複抽取 (用於 draw，預設 false 不放回)'
        }
      },
      required: ['mode']
    }
  }
};

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function executeRandomDraw(args) {
  const { mode, min = 1, max = 100, count = 1, sides = 6, options = [], allowReplacement = false } = args || {};

  try {
    switch (mode) {
      case 'meihua_numbers': {
        const n1 = getRandomInt(1, 999);
        const n2 = getRandomInt(1, 999);
        const n3 = getRandomInt(1, 999);
        return {
          success: true,
          mode,
          numbers: [n1, n2, n3],
          formattedText: `梅花易數隨機靈動數已產生：${n1}、${n2}、${n3}（可用於梅花起卦）`
        };
      }

      case 'range': {
        if (min > max) {
          throw new Error(`最小值 (${min}) 不可大於最大值 (${max})`);
        }
        const safeCount = Math.min(Math.max(1, count), 100);
        const results = [];
        for (let i = 0; i < safeCount; i++) {
          results.push(getRandomInt(min, max));
        }
        return {
          success: true,
          mode,
          min,
          max,
          count: safeCount,
          results,
          formattedText: `在 [${min}, ${max}] 區間隨機選取 ${safeCount} 個數值：${results.join(', ')}`
        };
      }

      case 'dice': {
        const safeSides = Math.max(2, sides);
        const safeCount = Math.min(Math.max(1, count), 50);
        const rolls = [];
        let total = 0;
        for (let i = 0; i < safeCount; i++) {
          const val = getRandomInt(1, safeSides);
          rolls.push(val);
          total += val;
        }
        return {
          success: true,
          mode,
          sides: safeSides,
          count: safeCount,
          rolls,
          total,
          formattedText: `擲出 ${safeCount} 顆 ${safeSides} 面骰：[${rolls.join(', ')}]，總和為 ${total}`
        };
      }

      case 'draw': {
        if (!Array.isArray(options) || options.length === 0) {
          throw new Error('抽籤模式需要提供非空的選項清單 (options)');
        }
        const safeCount = Math.min(Math.max(1, count), allowReplacement ? 100 : options.length);
        const pool = [...options];
        const drawn = [];

        for (let i = 0; i < safeCount; i++) {
          if (pool.length === 0) break;
          const idx = getRandomInt(0, pool.length - 1);
          if (allowReplacement) {
            drawn.push(pool[idx]);
          } else {
            drawn.push(pool.splice(idx, 1)[0]);
          }
        }

        return {
          success: true,
          mode,
          drawn,
          formattedText: `抽籤結果 (${safeCount} 項)：${drawn.join('、')}`
        };
      }

      default:
        throw new Error(`未知的隨機抽籤模式: "${mode}"`);
    }
  } catch (err) {
    return {
      success: false,
      isError: true,
      mode,
      error: err.message,
      formattedText: `[隨機抽籤錯誤] ${err.message}`
    };
  }
}
