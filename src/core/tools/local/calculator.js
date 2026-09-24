/**
 * Deterministic Safe Calculator Tool (Zero-eval, Shunting-Yard Evaluator)
 */

export const CALCULATOR_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'calculator',
    description: '執行數學算式計算。支援加減乘除(+ - * /)、乘冪(^)、取餘(%)、括號、常用函數(sqrt, sin, cos, tan, log, ln, abs)與常數(pi, e)。禁止使用 eval。',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '要計算的數學算式，例如 "((12 + 34) * 5) / 2" 或 "sqrt(144) + 3^2"'
        }
      },
      required: ['expression']
    }
  }
};

const OPERATORS = {
  '+': { precedence: 2, associativity: 'L', fn: (a, b) => a + b },
  '-': { precedence: 2, associativity: 'L', fn: (a, b) => a - b },
  '*': { precedence: 3, associativity: 'L', fn: (a, b) => a * b },
  '/': { precedence: 3, associativity: 'L', fn: (a, b) => {
    if (Math.abs(b) < 1e-15) throw new Error('除數不能為零');
    return a / b;
  }},
  '%': { precedence: 3, associativity: 'L', fn: (a, b) => {
    if (Math.abs(b) < 1e-15) throw new Error('取餘除數不能為零');
    return a % b;
  }},
  '^': { precedence: 4, associativity: 'R', fn: (a, b) => Math.pow(a, b) },
  'neg': { precedence: 5, associativity: 'R', unary: true, fn: (a) => -a }
};

const FUNCTIONS = {
  sqrt: (x) => {
    if (x < 0) throw new Error('平方根不可傳入負數');
    return Math.sqrt(x);
  },
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: (x) => {
    if (x <= 0) throw new Error('常用對數 (log) 輸入必須大於 0');
    return Math.log10(x);
  },
  ln: (x) => {
    if (x <= 0) throw new Error('自然對數 (ln) 輸入必須大於 0');
    return Math.log(x);
  },
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil
};

const CONSTANTS = {
  pi: Math.PI,
  e: Math.E
};

export function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number (including decimals)
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(s[i + 1] || ''))) {
      let numStr = '';
      while (i < s.length && (/[\d.]/.test(s[i]))) {
        numStr += s[i];
        i++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) throw new Error(`無效的數值格式: ${numStr}`);
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers (functions, constants)
    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        idStr += s[i];
        i++;
      }
      const lower = idStr.toLowerCase();
      if (CONSTANTS.hasOwnProperty(lower)) {
        tokens.push({ type: 'number', value: CONSTANTS[lower] });
      } else if (FUNCTIONS.hasOwnProperty(lower)) {
        tokens.push({ type: 'function', value: lower });
      } else {
        throw new Error(`未知的常數或函數: "${idStr}"`);
      }
      continue;
    }

    // Operators
    if (['+', '-', '*', '/', '^', '%'].includes(ch)) {
      // Check for unary minus: if at start or previous token is an operator or '('
      const prev = tokens[tokens.length - 1];
      const isUnaryMinus = ch === '-' && (!prev || prev.type === 'operator' || prev.type === 'left_paren');
      const isUnaryPlus = ch === '+' && (!prev || prev.type === 'operator' || prev.type === 'left_paren');

      if (isUnaryMinus) {
        tokens.push({ type: 'operator', value: 'neg' });
      } else if (isUnaryPlus) {
        // Unary plus is a no-op, ignore
      } else {
        tokens.push({ type: 'operator', value: ch });
      }
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'left_paren', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'right_paren', value: ')' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }

    throw new Error(`不合法字符: "${ch}"`);
  }

  return tokens;
}

export function evaluateExpression(expression) {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new Error('請輸入有效的數學算式');
  }

  // Safety check: block potential code execution keywords
  if (/(import|require|process|global|window|document|eval|Function|while|for|if|class|return)/i.test(expression)) {
    throw new Error('拒絕包含潛在危險關鍵字的算式');
  }

  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new Error('算式為空');
  }

  // Shunting-yard algorithm to RPN
  const outputQueue = [];
  const operatorStack = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'number') {
      outputQueue.push(token);
    } else if (token.type === 'function') {
      operatorStack.push(token);
    } else if (token.type === 'comma') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].type !== 'left_paren') {
        outputQueue.push(operatorStack.pop());
      }
      if (operatorStack.length === 0) {
        throw new Error('逗號位置錯誤或缺少括號');
      }
    } else if (token.type === 'operator') {
      const o1 = token;
      const opInfo1 = OPERATORS[o1.value];

      while (operatorStack.length > 0) {
        const top = operatorStack[operatorStack.length - 1];
        if (top.type === 'operator') {
          const opInfo2 = OPERATORS[top.value];
          if (
            (opInfo1.associativity === 'L' && opInfo1.precedence <= opInfo2.precedence) ||
            (opInfo1.associativity === 'R' && opInfo1.precedence < opInfo2.precedence)
          ) {
            outputQueue.push(operatorStack.pop());
            continue;
          }
        } else if (top.type === 'function') {
          outputQueue.push(operatorStack.pop());
          continue;
        }
        break;
      }
      operatorStack.push(o1);
    } else if (token.type === 'left_paren') {
      operatorStack.push(token);
    } else if (token.type === 'right_paren') {
      let matched = false;
      while (operatorStack.length > 0) {
        const top = operatorStack.pop();
        if (top.type === 'left_paren') {
          matched = true;
          break;
        }
        outputQueue.push(top);
      }
      if (!matched) {
        throw new Error('括號不匹配: 多餘的右括號 ")"');
      }
      if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].type === 'function') {
        outputQueue.push(operatorStack.pop());
      }
    }
  }

  while (operatorStack.length > 0) {
    const top = operatorStack.pop();
    if (top.type === 'left_paren' || top.type === 'right_paren') {
      throw new Error('括號不匹配: 缺少閉合括號');
    }
    outputQueue.push(top);
  }

  // Evaluate RPN
  const evalStack = [];
  for (const token of outputQueue) {
    if (token.type === 'number') {
      evalStack.push(token.value);
    } else if (token.type === 'operator') {
      const op = OPERATORS[token.value];
      if (op && op.unary) {
        if (evalStack.length < 1) {
          throw new Error(`一元運算子 "${token.value}" 缺少操作數`);
        }
        const a = evalStack.pop();
        const res = op.fn(a);
        evalStack.push(res);
      } else {
        if (evalStack.length < 2) {
          throw new Error(`運算子 "${token.value}" 缺少足夠的操作數`);
        }
        const b = evalStack.pop();
        const a = evalStack.pop();
        const fn = op.fn;
        const res = fn(a, b);
        if (!Number.isFinite(res)) {
          throw new Error('計算結果超出有效數值範圍或為非數值 (NaN/Infinity)');
        }
        evalStack.push(res);
      }
    } else if (token.type === 'function') {
      if (evalStack.length < 1) {
        throw new Error(`函數 "${token.value}" 缺少參數`);
      }
      const arg = evalStack.pop();
      const fn = FUNCTIONS[token.value];
      const res = fn(arg);
      if (!Number.isFinite(res)) {
        throw new Error(`函數 "${token.value}" 計算結果無效`);
      }
      evalStack.push(res);
    }
  }

  if (evalStack.length !== 1) {
    throw new Error('算式無效，未能求得單一結果');
  }

  const rawResult = evalStack[0];
  // Format result to avoid 0.30000000000000004
  const rounded = Math.abs(rawResult - Math.round(rawResult)) < 1e-12
    ? Math.round(rawResult)
    : Number(rawResult.toPrecision(12)) / 1;

  return rounded;
}

export function executeCalculator(args) {
  const { expression } = args || {};
  try {
    const result = evaluateExpression(expression);
    return {
      success: true,
      expression,
      result,
      formattedText: `計算結果: ${expression} = ${result}`
    };
  } catch (err) {
    return {
      success: false,
      isError: true,
      expression,
      error: err.message,
      formattedText: `[計算錯誤] ${err.message}`
    };
  }
}
