/**
 * Current DateTime, Chinese Double-hour (時辰), and Solar Terms Tool
 */

export const DATETIME_NOW_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'datetime_now',
    description: '獲取當前即時日期時間、星期、十二時辰（子丑寅卯...）與下一個二十四節氣倒數。',
    parameters: {
      type: 'object',
      properties: {
        timeZone: {
          type: 'string',
          description: '時區 (預設為系統當地時區或 Asia/Taipei)'
        }
      }
    }
  }
};

const SHICHEN = [
  { name: '子時', startHour: 23, endHour: 1, branch: '子', animal: '鼠', element: '水' },
  { name: '丑時', startHour: 1, endHour: 3, branch: '丑', animal: '牛', element: '土' },
  { name: '寅時', startHour: 3, endHour: 5, branch: '寅', animal: '虎', element: '木' },
  { name: '卯時', startHour: 5, endHour: 7, branch: '卯', animal: '兔', element: '木' },
  { name: '辰時', startHour: 7, endHour: 9, branch: '辰', animal: '龍', element: '土' },
  { name: '巳時', startHour: 9, endHour: 11, branch: '巳', animal: '蛇', element: '火' },
  { name: '午時', startHour: 11, endHour: 13, branch: '午', animal: '馬', element: '火' },
  { name: '未時', startHour: 13, endHour: 15, branch: '未', animal: '羊', element: '土' },
  { name: '申時', startHour: 15, endHour: 17, branch: '申', animal: '猴', element: '金' },
  { name: '酉時', startHour: 17, endHour: 19, branch: '酉', animal: '雞', element: '金' },
  { name: '戌時', startHour: 19, endHour: 21, branch: '戌', animal: '狗', element: '土' },
  { name: '亥時', startHour: 21, endHour: 23, branch: '亥', animal: '豬', element: '水' }
];

// Approximate 24 Solar Terms calendar dates (Month is 1-indexed, day ±1 day)
const SOLAR_TERMS = [
  { name: '小寒', month: 1, approxDay: 5 },
  { name: '大寒', month: 1, approxDay: 20 },
  { name: '立春', month: 2, approxDay: 4 },
  { name: '雨水', month: 2, approxDay: 19 },
  { name: '驚蟄', month: 3, approxDay: 5 },
  { name: '春分', month: 3, approxDay: 20 },
  { name: '清明', month: 4, approxDay: 4 },
  { name: '穀雨', month: 4, approxDay: 20 },
  { name: '立夏', month: 5, approxDay: 5 },
  { name: '小滿', month: 5, approxDay: 21 },
  { name: '芒種', month: 6, approxDay: 6 },
  { name: '夏至', month: 6, approxDay: 21 },
  { name: '小暑', month: 7, approxDay: 7 },
  { name: '大暑', month: 7, approxDay: 23 },
  { name: '立秋', month: 8, approxDay: 7 },
  { name: '處暑', month: 8, approxDay: 23 },
  { name: '白露', month: 9, approxDay: 7 },
  { name: '秋分', month: 9, approxDay: 23 },
  { name: '寒露', month: 10, approxDay: 8 },
  { name: '霜降', month: 10, approxDay: 23 },
  { name: '立冬', month: 11, approxDay: 7 },
  { name: '小雪', month: 11, approxDay: 22 },
  { name: '大雪', month: 12, approxDay: 7 },
  { name: '冬至', month: 12, approxDay: 22 }
];

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function getShichen(hour) {
  if (hour >= 23 || hour < 1) return SHICHEN[0];
  for (let i = 1; i < SHICHEN.length; i++) {
    if (hour >= SHICHEN[i].startHour && hour < SHICHEN[i].endHour) {
      return SHICHEN[i];
    }
  }
  return SHICHEN[0];
}

export function getNextSolarTerm(now = new Date()) {
  const currentYear = now.getFullYear();
  const candidates = [];

  for (const year of [currentYear, currentYear + 1]) {
    for (const term of SOLAR_TERMS) {
      const termDate = new Date(year, term.month - 1, term.approxDay, 12, 0, 0);
      if (termDate > now) {
        candidates.push({
          name: term.name,
          date: termDate,
          daysAway: Math.ceil((termDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        });
      }
    }
  }

  candidates.sort((a, b) => a.date - b.date);
  return candidates[0] || null;
}

export function executeDateTimeNow(args) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const isoDate = `${year}-${month}-${date}`;
    const isoTime = `${hours}:${minutes}:${seconds}`;
    const weekday = WEEKDAYS_ZH[now.getDay()];

    const currentShichen = getShichen(now.getHours());
    const nextSolarTerm = getNextSolarTerm(now);

    const solarTermText = nextSolarTerm
      ? `下個節氣：約 ${nextSolarTerm.daysAway} 天後「${nextSolarTerm.name}」（約 ${nextSolarTerm.date.getFullYear()}-${String(nextSolarTerm.date.getMonth() + 1).padStart(2, '0')}-${String(nextSolarTerm.date.getDate()).padStart(2, '0')}，近似±1天）`
      : '';

    const formattedText = `當前時間：${isoDate} ${isoTime} (${weekday})\n當前時辰：${currentShichen.name}（${currentShichen.branch}時 / 五行屬${currentShichen.element} / 生肖${currentShichen.animal}）\n${solarTermText}`;

    return {
      success: true,
      timestamp: now.getTime(),
      date: isoDate,
      time: isoTime,
      weekday,
      shichen: {
        name: currentShichen.name,
        branch: currentShichen.branch,
        element: currentShichen.element,
        animal: currentShichen.animal
      },
      nextSolarTerm: nextSolarTerm ? {
        name: nextSolarTerm.name,
        approxDate: `${nextSolarTerm.date.getFullYear()}-${String(nextSolarTerm.date.getMonth() + 1).padStart(2, '0')}-${String(nextSolarTerm.date.getDate()).padStart(2, '0')}`,
        daysAway: nextSolarTerm.daysAway
      } : null,
      formattedText
    };
  } catch (err) {
    return {
      success: false,
      isError: true,
      error: err.message,
      formattedText: `[時間獲取錯誤] ${err.message}`
    };
  }
}
