export const HEXAGRAM_TABLE = {
  // 乾(1)上
  '1,1': { id: 1, name: '乾', fullName: '乾為天', upper: '乾', lower: '乾' },
  '1,2': { id: 10, name: '履', fullName: '天澤履', upper: '乾', lower: '兌' },
  '1,3': { id: 13, name: '同人', fullName: '天火同人', upper: '乾', lower: '離' },
  '1,4': { id: 25, name: '無妄', fullName: '天雷無妄', upper: '乾', lower: '震' },
  '1,5': { id: 44, name: '姤', fullName: '天風姤', upper: '乾', lower: '巽' },
  '1,6': { id: 6, name: '訟', fullName: '天水訟', upper: '乾', lower: '坎' },
  '1,7': { id: 33, name: '遯', fullName: '天山遯', upper: '乾', lower: '艮' },
  '1,8': { id: 12, name: '否', fullName: '天地否', upper: '乾', lower: '坤' },

  // 兌(2)上
  '2,1': { id: 43, name: '夬', fullName: '澤天夬', upper: '兌', lower: '乾' },
  '2,2': { id: 58, name: '兌', fullName: '兌為澤', upper: '兌', lower: '兌' },
  '2,3': { id: 49, name: '革', fullName: '澤火革', upper: '兌', lower: '離' },
  '2,4': { id: 17, name: '隨', fullName: '澤雷隨', upper: '兌', lower: '震' },
  '2,5': { id: 28, name: '大過', fullName: '澤風大過', upper: '兌', lower: '巽' },
  '2,6': { id: 47, name: '困', fullName: '澤水困', upper: '兌', lower: '坎' },
  '2,7': { id: 31, name: '咸', fullName: '澤山咸', upper: '兌', lower: '艮' },
  '2,8': { id: 45, name: '萃', fullName: '澤地萃', upper: '兌', lower: '坤' },

  // 離(3)上
  '3,1': { id: 14, name: '大有', fullName: '火天大有', upper: '離', lower: '乾' },
  '3,2': { id: 38, name: '睽', fullName: '火澤睽', upper: '離', lower: '兌' },
  '3,3': { id: 30, name: '離', fullName: '離為火', upper: '離', lower: '離' },
  '3,4': { id: 21, name: '噬嗑', fullName: '火雷噬嗑', upper: '離', lower: '震' },
  '3,5': { id: 50, name: '鼎', fullName: '火風鼎', upper: '離', lower: '巽' },
  '3,6': { id: 64, name: '未濟', fullName: '火水未濟', upper: '離', lower: '坎' },
  '3,7': { id: 56, name: '旅', fullName: '火山旅', upper: '離', lower: '艮' },
  '3,8': { id: 35, name: '晉', fullName: '火地晉', upper: '離', lower: '坤' },

  // 震(4)上
  '4,1': { id: 34, name: '大壯', fullName: '雷天大壯', upper: '震', lower: '乾' },
  '4,2': { id: 54, name: '歸妹', fullName: '雷澤歸妹', upper: '震', lower: '兌' },
  '4,3': { id: 55, name: '豐', fullName: '雷火豐', upper: '震', lower: '離' },
  '4,4': { id: 51, name: '震', fullName: '震為雷', upper: '震', lower: '震' },
  '4,5': { id: 32, name: '恆', fullName: '雷風恆', upper: '震', lower: '巽' },
  '4,6': { id: 40, name: '解', fullName: '雷水解', upper: '震', lower: '坎' },
  '4,7': { id: 62, name: '小過', fullName: '雷山小過', upper: '震', lower: '艮' },
  '4,8': { id: 16, name: '豫', fullName: '雷地豫', upper: '震', lower: '坤' },

  // 巽(5)上
  '5,1': { id: 9, name: '小畜', fullName: '風天小畜', upper: '巽', lower: '乾' },
  '5,2': { id: 61, name: '中孚', fullName: '風澤中孚', upper: '巽', lower: '兌' },
  '5,3': { id: 37, name: '家人', fullName: '風火家人', upper: '巽', lower: '離' },
  '5,4': { id: 42, name: '益', fullName: '風雷益', upper: '巽', lower: '震' },
  '5,5': { id: 57, name: '巽', fullName: '巽為風', upper: '巽', lower: '巽' },
  '5,6': { id: 59, name: '渙', fullName: '風水渙', upper: '巽', lower: '坎' },
  '5,7': { id: 53, name: '漸', fullName: '風山漸', upper: '巽', lower: '艮' },
  '5,8': { id: 20, name: '觀', fullName: '風地觀', upper: '巽', lower: '坤' },

  // 坎(6)上
  '6,1': { id: 5, name: '需', fullName: '水天需', upper: '坎', lower: '乾' },
  '6,2': { id: 60, name: '節', fullName: '水澤節', upper: '坎', lower: '兌' },
  '6,3': { id: 63, name: '既濟', fullName: '水火既濟', upper: '坎', lower: '離' },
  '6,4': { id: 3, name: '屯', fullName: '水雷屯', upper: '坎', lower: '震' },
  '6,5': { id: 48, name: '井', fullName: '水風井', upper: '坎', lower: '巽' },
  '6,6': { id: 29, name: '坎', fullName: '坎為水', upper: '坎', lower: '坎' },
  '6,7': { id: 39, name: '蹇', fullName: '水山蹇', upper: '坎', lower: '艮' },
  '6,8': { id: 8, name: '比', fullName: '水地比', upper: '坎', lower: '坤' },

  // 艮(7)上
  '7,1': { id: 26, name: '大畜', fullName: '山天大畜', upper: '艮', lower: '乾' },
  '7,2': { id: 41, name: '損', fullName: '山澤損', upper: '艮', lower: '兌' },
  '7,3': { id: 22, name: '賁', fullName: '山火賁', upper: '艮', lower: '離' },
  '7,4': { id: 27, name: '頤', fullName: '山雷頤', upper: '艮', lower: '震' },
  '7,5': { id: 18, name: '蠱', fullName: '山風蠱', upper: '艮', lower: '巽' },
  '7,6': { id: 4, name: '蒙', fullName: '山水蒙', upper: '艮', lower: '坎' },
  '7,7': { id: 52, name: '艮', fullName: '艮為山', upper: '艮', lower: '艮' },
  '7,8': { id: 23, name: '剝', fullName: '山地剝', upper: '艮', lower: '坤' },

  // 坤(8)上
  '8,1': { id: 11, name: '泰', fullName: '地天泰', upper: '坤', lower: '乾' },
  '8,2': { id: 19, name: '臨', fullName: '地澤臨', upper: '坤', lower: '兌' },
  '8,3': { id: 36, name: '明夷', fullName: '地火明夷', upper: '坤', lower: '離' },
  '8,4': { id: 24, name: '復', fullName: '地雷復', upper: '坤', lower: '震' },
  '8,5': { id: 46, name: '升', fullName: '地風升', upper: '坤', lower: '巽' },
  '8,6': { id: 7, name: '師', fullName: '地水師', upper: '坤', lower: '坎' },
  '8,7': { id: 15, name: '謙', fullName: '地山謙', upper: '坤', lower: '艮' },
  '8,8': { id: 2, name: '坤', fullName: '坤為地', upper: '坤', lower: '坤' }
};

export function lookupHexagram(upperTrigramId, lowerTrigramId) {
  return HEXAGRAM_TABLE[`${upperTrigramId},${lowerTrigramId}`] || null;
}

export function getHexagramById(kingWenId) {
  for (const key in HEXAGRAM_TABLE) {
    if (HEXAGRAM_TABLE[key].id === kingWenId) {
      return HEXAGRAM_TABLE[key];
    }
  }
  return null;
}
