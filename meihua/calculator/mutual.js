import { binaryToTrigramId } from './bagua.js';
import { lookupHexagram } from './hexagram.js';

export function calculateMutual(lines) {
  // lines are [L1, L2, L3, L4, L5, L6] from bottom to top
  const lowerMutualLines = [lines[1], lines[2], lines[3]];
  const upperMutualLines = [lines[2], lines[3], lines[4]];

  const lowerTrigramId = binaryToTrigramId(lowerMutualLines);
  const upperTrigramId = binaryToTrigramId(upperMutualLines);

  const hexagram = lookupHexagram(upperTrigramId, lowerTrigramId);

  return {
    upper: upperTrigramId,
    lower: lowerTrigramId,
    hexagram,
    lines: [...lowerMutualLines, ...upperMutualLines]
  };
}
