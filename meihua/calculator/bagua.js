export const TRIGRAMS = [
  { id: 1, name: '乾', symbol: '☰', binary: [1, 1, 1], element: '金', nature: '天', direction: '西北', family: '父' },
  { id: 2, name: '兌', symbol: '☱', binary: [1, 1, 0], element: '金', nature: '澤', direction: '西', family: '少女' },
  { id: 3, name: '離', symbol: '☲', binary: [1, 0, 1], element: '火', nature: '火', direction: '南', family: '中女' },
  { id: 4, name: '震', symbol: '☳', binary: [1, 0, 0], element: '木', nature: '雷', direction: '東', family: '長男' },
  { id: 5, name: '巽', symbol: '☴', binary: [0, 1, 1], element: '木', nature: '風', direction: '東南', family: '長女' },
  { id: 6, name: '坎', symbol: '☵', binary: [0, 1, 0], element: '水', nature: '水', direction: '北', family: '中男' },
  { id: 7, name: '艮', symbol: '☶', binary: [0, 0, 1], element: '土', nature: '山', direction: '東北', family: '少男' },
  { id: 8, name: '坤', symbol: '☷', binary: [0, 0, 0], element: '土', nature: '地', direction: '西南', family: '母' }
];

export function getTrigramById(id) {
  return TRIGRAMS.find(t => t.id === id);
}

export function getTrigramByName(name) {
  return TRIGRAMS.find(t => t.name === name);
}

export function trigramIdToBinary(id) {
  const trigram = getTrigramById(id);
  return trigram ? [...trigram.binary] : null;
}

export function binaryToTrigramId(binary) {
  const trigram = TRIGRAMS.find(t => t.binary[0] === binary[0] && t.binary[1] === binary[1] && t.binary[2] === binary[2]);
  return trigram ? trigram.id : null;
}
