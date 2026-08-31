export const ELEMENTS = ['金', '木', '水', '火', '土'];

export const SHENG_CYCLE = {
  '木': '火',
  '火': '土',
  '土': '金',
  '金': '水',
  '水': '木'
};

export const KE_CYCLE = {
  '木': '土',
  '土': '水',
  '水': '火',
  '火': '金',
  '金': '木'
};

export function getElementRelation(tiElement, yongElement) {
  if (tiElement === yongElement) {
    return '比和';
  } else if (SHENG_CYCLE[yongElement] === tiElement) {
    return '用生體';
  } else if (SHENG_CYCLE[tiElement] === yongElement) {
    return '體生用';
  } else if (KE_CYCLE[yongElement] === tiElement) {
    return '用剋體';
  } else if (KE_CYCLE[tiElement] === yongElement) {
    return '體剋用';
  }
  return '未知';
}
