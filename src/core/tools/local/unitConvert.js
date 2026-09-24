/**
 * Unit Converter Local Tool
 * Supports Length, Weight, Area, Speed, Temperature, and Volume conversions.
 * Currency conversions are explicitly excluded and guided to web_search for real-time rates.
 */

export const UNIT_CONVERTER_TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: 'unit_converter',
    description: '單位換算工具。支援長度、重量、面積、速度、溫度、容積換算（含公制、英制、台制如坪/甲/台斤/台尺）。注意：貨幣匯率換算請使用 web_search 查詢即時匯率。',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['length', 'weight', 'area', 'speed', 'temperature', 'volume'],
          description: '換算類別'
        },
        value: {
          type: 'number',
          description: '數值'
        },
        fromUnit: {
          type: 'string',
          description: '來源單位 (例如 m, km, cm, inch, ft, 坪, 甲, kg, g, lb, 台斤, C, F, km/h, mph, l, ml)'
        },
        toUnit: {
          type: 'string',
          description: '目標單位'
        }
      },
      required: ['value', 'fromUnit', 'toUnit']
    }
  }
};

// Base units:
// length: meter (m)
// weight: gram (g)
// area: square meter (m2)
// speed: meter per second (m/s)
// volume: liter (l)

const UNIT_MAPS = {
  length: {
    m: 1,
    meter: 1,
    米: 1,
    公尺: 1,
    km: 1000,
    kilometer: 1000,
    公里: 1000,
    cm: 0.01,
    centimeter: 0.01,
    公分: 0.01,
    mm: 0.001,
    millimeter: 0.001,
    毫米: 0.001,
    inch: 0.0254,
    in: 0.0254,
    吋: 0.0254,
    英寸: 0.0254,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    呎: 0.3048,
    英尺: 0.3048,
    yard: 0.9144,
    yd: 0.9144,
    碼: 0.9144,
    mile: 1609.344,
    mi: 1609.344,
    英里: 1609.344,
    台尺: 10 / 33, // ~0.30303 m
    丈: 100 / 33,
    里: 500
  },
  weight: {
    g: 1,
    gram: 1,
    克: 1,
    kg: 1000,
    kilogram: 1000,
    公斤: 1000,
    mg: 0.001,
    毫克: 0.001,
    t: 1000000,
    ton: 1000000,
    公噸: 1000000,
    噸: 1000000,
    lb: 453.59237,
    pound: 453.59237,
    磅: 453.59237,
    oz: 28.349523125,
    ounce: 28.349523125,
    盎司: 28.349523125,
    台斤: 600,
    斤: 600,
    兩: 37.5, // 1台斤 = 16兩 -> 600/16 = 37.5g
    台兩: 37.5,
    錢: 3.75
  },
  area: {
    m2: 1,
    sqm: 1,
    平方公尺: 1,
    km2: 1000000,
    平方公里: 1000000,
    ha: 10000,
    公頃: 10000,
    ping: 400 / 121, // ~3.305785 m2
    坪: 400 / 121,
    jia: 9699.17, // 1甲 = 2934坪 ~ 9699.17 m2
    甲: 9699.17,
    sqft: 0.092903,
    平方英尺: 0.092903,
    acre: 4046.8564,
    英畝: 4046.8564
  },
  speed: {
    'm/s': 1,
    mps: 1,
    'km/h': 1 / 3.6,
    kph: 1 / 3.6,
    公里每小時: 1 / 3.6,
    時速公里: 1 / 3.6,
    mph: 0.44704,
    英里每小時: 0.44704,
    knot: 0.514444,
    節: 0.514444
  },
  volume: {
    l: 1,
    liter: 1,
    升: 1,
    公升: 1,
    ml: 0.001,
    milliliter: 0.001,
    毫升: 0.001,
    cc: 0.001,
    m3: 1000,
    立方公尺: 1000,
    gallon: 3.785411784, // 美制加侖
    gal: 3.785411784,
    加侖: 3.785411784,
    cup: 0.24, // 美制杯 ~240ml
    杯: 0.24
  }
};

function normalizeUnit(u) {
  if (!u || typeof u !== 'string') return '';
  return u.trim().toLowerCase();
}

function convertTemperature(val, from, to) {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);

  // Normalize to Celsius
  let celsius;
  if (f === 'c' || f === 'celsius' || f === '攝氏' || f === '°c') {
    celsius = val;
  } else if (f === 'f' || f === 'fahrenheit' || f === '華氏' || f === '°f') {
    celsius = (val - 32) * (5 / 9);
  } else if (f === 'k' || f === 'kelvin' || f === '絕對溫度' || f === '克氏') {
    celsius = val - 273.15;
  } else {
    throw new Error(`不支援的溫度來源單位: "${from}"`);
  }

  // Convert from Celsius to Target
  if (t === 'c' || t === 'celsius' || t === '攝氏' || t === '°c') {
    return celsius;
  } else if (t === 'f' || t === 'fahrenheit' || t === '華氏' || t === '°f') {
    return (celsius * 9 / 5) + 32;
  } else if (t === 'k' || t === 'kelvin' || t === '絕對溫度' || t === '克氏') {
    return celsius + 273.15;
  } else {
    throw new Error(`不支援的溫度目標單位: "${to}"`);
  }
}

export function executeUnitConverter(args) {
  const { category, value, fromUnit, toUnit } = args || {};

  try {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error('請提供有效的數值 (value)');
    }
    if (!fromUnit || !toUnit) {
      throw new Error('請提供來源單位 (fromUnit) 與目標單位 (toUnit)');
    }

    const normFrom = normalizeUnit(fromUnit);
    const normTo = normalizeUnit(toUnit);

    // Currency check
    if (['usd', 'twd', 'jpy', 'cny', 'eur', 'ntd', '美金', '台幣', '日圓', '人民幣', '歐元'].includes(normFrom) ||
        ['usd', 'twd', 'jpy', 'cny', 'eur', 'ntd', '美金', '台幣', '日圓', '人民幣', '歐元'].includes(normTo)) {
      throw new Error('貨幣換算需要即時動態匯率，請使用 web_search 工具查詢當前匯率');
    }

    // Auto-detect category if not specified or check category
    let matchedCategory = category;
    if (!matchedCategory) {
      if (['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin', '攝氏', '華氏'].includes(normFrom)) {
        matchedCategory = 'temperature';
      } else {
        for (const [catName, map] of Object.entries(UNIT_MAPS)) {
          if (map.hasOwnProperty(normFrom) && map.hasOwnProperty(normTo)) {
            matchedCategory = catName;
            break;
          }
        }
      }
    }

    if (matchedCategory === 'temperature') {
      const converted = convertTemperature(value, fromUnit, toUnit);
      const rounded = Number(converted.toFixed(4));
      return {
        success: true,
        category: 'temperature',
        originalValue: value,
        fromUnit,
        toUnit,
        result: rounded,
        formattedText: `${value} ${fromUnit} = ${rounded} ${toUnit}`
      };
    }

    if (!matchedCategory || !UNIT_MAPS[matchedCategory]) {
      // Search all categories
      let foundCategory = null;
      for (const [catName, map] of Object.entries(UNIT_MAPS)) {
        if (map.hasOwnProperty(normFrom)) {
          foundCategory = catName;
          break;
        }
      }
      if (!foundCategory) {
        throw new Error(`無法識別來源單位: "${fromUnit}"`);
      }
      matchedCategory = foundCategory;
    }

    const map = UNIT_MAPS[matchedCategory];
    if (!map.hasOwnProperty(normFrom)) {
      throw new Error(`類別 "${matchedCategory}" 中未找到來源單位: "${fromUnit}"`);
    }
    if (!map.hasOwnProperty(normTo)) {
      throw new Error(`類別 "${matchedCategory}" 中未找到目標單位: "${toUnit}"`);
    }

    // Convert from -> base -> to
    const baseValue = value * map[normFrom];
    const converted = baseValue / map[normTo];
    const rounded = Number(converted.toPrecision(8)) / 1;

    return {
      success: true,
      category: matchedCategory,
      originalValue: value,
      fromUnit,
      toUnit,
      result: rounded,
      formattedText: `${value} ${fromUnit} = ${rounded} ${toUnit}`
    };
  } catch (err) {
    return {
      success: false,
      isError: true,
      error: err.message,
      formattedText: `[單位換算錯誤] ${err.message}`
    };
  }
}
