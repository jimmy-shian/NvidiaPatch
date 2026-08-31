import { getTrigramById } from './bagua.js';

export function determineTiYong(upperTrigramId, lowerTrigramId, movingLine) {
  const upperTrigram = getTrigramById(upperTrigramId);
  const lowerTrigram = getTrigramById(lowerTrigramId);

  let ti, yong;

  if (movingLine >= 1 && movingLine <= 3) {
    // 動爻在下卦：下為用，上為體
    ti = { position: 'upper', trigram: upperTrigram };
    yong = { position: 'lower', trigram: lowerTrigram };
  } else {
    // 動爻在上卦：上為用，下為體
    ti = { position: 'lower', trigram: lowerTrigram };
    yong = { position: 'upper', trigram: upperTrigram };
  }

  return { ti, yong };
}
