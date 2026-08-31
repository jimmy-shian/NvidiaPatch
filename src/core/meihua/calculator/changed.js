import { binaryToTrigramId } from './bagua.js';
import { lookupHexagram } from './hexagram.js';

export function calculateChanged(lines, movingLine) {
  const newLines = [...lines];
  const index = movingLine - 1;
  newLines[index] = newLines[index] === 1 ? 0 : 1;

  const lowerLines = [newLines[0], newLines[1], newLines[2]];
  const upperLines = [newLines[3], newLines[4], newLines[5]];

  const lowerTrigramId = binaryToTrigramId(lowerLines);
  const upperTrigramId = binaryToTrigramId(upperLines);

  const hexagram = lookupHexagram(upperTrigramId, lowerTrigramId);

  return {
    upper: upperTrigramId,
    lower: lowerTrigramId,
    hexagram,
    lines: newLines
  };
}
