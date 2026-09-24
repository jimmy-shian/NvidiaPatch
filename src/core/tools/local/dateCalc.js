/**
 * Date Calculator Tool
 * Supports date difference, date offset, day of week, age calculation, and countdown.
 */

export const DATE_CALC_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'date_calculator',
    description: '計算日期差、加減天數、星期幾、年齡與倒數天數。支援 YYYY-MM-DD 或中文日期格式。',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['diff', 'add_subtract', 'day_of_week', 'age', 'countdown'],
          description: '操作類型：diff (日期差), add_subtract (加減日期), day_of_week (星期幾), age (年齡), countdown (倒數天數)'
        },
        date: {
          type: 'string',
          description: '主要日期 (格式 YYYY-MM-DD 或 2024年5月1日)'
        },
        targetDate: {
          type: 'string',
          description: '目標日期 (用於 diff 操作)'
        },
        days: {
          type: 'number',
          description: '位移天數 (正數代表往後，負數代表往前，用於 add_subtract)'
        },
        months: {
          type: 'number',
          description: '位移月數 (用於 add_subtract)'
        },
        years: {
          type: 'number',
          description: '位移年數 (用於 add_subtract)'
        }
      },
      required: ['operation']
    }
  }
};

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function parseDateString(str) {
  if (!str || typeof str !== 'string') {
    throw new Error('請提供有效的日期字串');
  }
  const clean = str.trim()
    .replace(/年|月/g, '-')
    .replace(/日|號/g, '')
    .replace(/\//g, '-');

  const match = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    // Try standard Date.parse
    const d = new Date(str);
    if (isNaN(d.getTime())) {
      throw new Error(`無法解析日期格式: "${str}"，請使用 YYYY-MM-DD`);
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);

  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) {
    throw new Error(`無效的月日曆日期: "${str}"`);
  }
  return d;
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function executeDateCalculator(args) {
  const { operation, date, targetDate, days = 0, months = 0, years = 0 } = args || {};

  try {
    const today = new Date();
    const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    switch (operation) {
      case 'diff': {
        if (!date || !targetDate) {
          throw new Error('diff 操作需要提供 date 與 targetDate');
        }
        const d1 = parseDateString(date);
        const d2 = parseDateString(targetDate);
        const diffMs = d2.getTime() - d1.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        const absDays = Math.abs(diffDays);

        return {
          success: true,
          operation,
          startDate: formatDate(d1),
          endDate: formatDate(d2),
          diffDays,
          weeks: (absDays / 7).toFixed(1),
          formattedText: `${formatDate(d1)} 至 ${formatDate(d2)} 相差 ${diffDays} 天 (約 ${(absDays / 7).toFixed(1)} 週)`
        };
      }

      case 'add_subtract': {
        const base = date ? parseDateString(date) : todayZero;
        const res = new Date(base.getFullYear() + (years || 0), base.getMonth() + (months || 0), base.getDate() + (days || 0));
        const weekday = WEEKDAYS_ZH[res.getDay()];

        return {
          success: true,
          operation,
          baseDate: formatDate(base),
          resultDate: formatDate(res),
          weekday,
          formattedText: `基準日 ${formatDate(base)} 經位移後為: ${formatDate(res)} (${weekday})`
        };
      }

      case 'day_of_week': {
        const target = date ? parseDateString(date) : todayZero;
        const weekday = WEEKDAYS_ZH[target.getDay()];

        return {
          success: true,
          operation,
          date: formatDate(target),
          weekday,
          dayIndex: target.getDay(),
          formattedText: `${formatDate(target)} 是 ${weekday}`
        };
      }

      case 'age': {
        if (!date) throw new Error('age 操作需要提供出生日期 (date)');
        const birth = parseDateString(date);
        if (birth > todayZero) {
          throw new Error('出生日期不可大於今天');
        }

        let ageYears = todayZero.getFullYear() - birth.getFullYear();
        const m = todayZero.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && todayZero.getDate() < birth.getDate())) {
          ageYears--;
        }

        const totalDays = Math.round((todayZero.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));

        return {
          success: true,
          operation,
          birthDate: formatDate(birth),
          ageYears,
          totalDaysLived: totalDays,
          formattedText: `出生於 ${formatDate(birth)}，目前實歲為 ${ageYears} 歲 (已生活 ${totalDays} 天)`
        };
      }

      case 'countdown': {
        if (!date) throw new Error('countdown 操作需要提供目標日期 (date)');
        const target = parseDateString(date);
        const diffMs = target.getTime() - todayZero.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        let statusText = '';
        if (diffDays > 0) {
          statusText = `距離 ${formatDate(target)} 還有 ${diffDays} 天`;
        } else if (diffDays === 0) {
          statusText = `今天就是 ${formatDate(target)}！`;
        } else {
          statusText = `${formatDate(target)} 已經過去 ${Math.abs(diffDays)} 天`;
        }

        return {
          success: true,
          operation,
          targetDate: formatDate(target),
          daysRemaining: diffDays,
          formattedText: statusText
        };
      }

      default:
        throw new Error(`未知的日期操作類型: "${operation}"`);
    }
  } catch (err) {
    return {
      success: false,
      isError: true,
      operation,
      error: err.message,
      formattedText: `[日期計算錯誤] ${err.message}`
    };
  }
}
