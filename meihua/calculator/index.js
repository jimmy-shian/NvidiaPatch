import { trigramIdToBinary, getTrigramById } from './bagua.js';
import { lookupHexagram } from './hexagram.js';
import { numberCasting, timeCasting, randomCasting } from './casting.js';
import { calculateMutual } from './mutual.js';
import { calculateChanged } from './changed.js';
import { determineTiYong } from './tiyong.js';
import { getElementRelation } from './wuxing.js';

export function calculateMeihua(params = {}) {
  const { method = 'number', a, b, moving, date, question } = params;

  let castResult;
  if (method === 'time') {
    castResult = timeCasting(date);
  } else if (method === 'random') {
    castResult = randomCasting();
  } else {
    castResult = numberCasting({ a, b, moving });
  }

  const { upper, lower, movingLine, randomNumbers } = castResult;

  const upperBinary = trigramIdToBinary(upper);
  const lowerBinary = trigramIdToBinary(lower);
  const primaryLines = [...lowerBinary, ...upperBinary];
  const primaryHexagram = lookupHexagram(upper, lower);

  const mutual = calculateMutual(primaryLines);
  const changed = calculateChanged(primaryLines, movingLine);

  const tiYong = determineTiYong(upper, lower, movingLine);
  const relation = getElementRelation(tiYong.ti.trigram.element, tiYong.yong.trigram.element);

  return {
    method,
    question: question || null,
    randomNumbers: randomNumbers || null,
    primary: {
      hexagram: primaryHexagram,
      lines: primaryLines,
      upper: getTrigramById(upper),
      lower: getTrigramById(lower),
      movingLine
    },
    mutual: {
      hexagram: mutual.hexagram,
      lines: mutual.lines,
      upper: getTrigramById(mutual.upper),
      lower: getTrigramById(mutual.lower)
    },
    changed: {
      hexagram: changed.hexagram,
      lines: changed.lines,
      upper: getTrigramById(changed.upper),
      lower: getTrigramById(changed.lower)
    },
    tiYong: {
      ti: tiYong.ti,
      yong: tiYong.yong,
      relation
    }
  };
}

export * from './bagua.js';
export * from './hexagram.js';
export * from './casting.js';
export * from './mutual.js';
export * from './changed.js';
export * from './tiyong.js';
export * from './wuxing.js';
