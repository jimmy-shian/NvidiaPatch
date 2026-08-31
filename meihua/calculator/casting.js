export function numberCasting({ a, b, moving = null }) {
  let upper = Number(a) % 8;
  if (upper === 0) upper = 8;

  let lower = Number(b) % 8;
  if (lower === 0) lower = 8;

  let movingLine;
  if (moving !== null && moving !== undefined && moving !== '') {
    movingLine = Number(moving) % 6;
  } else {
    movingLine = (Number(a) + Number(b)) % 6;
  }
  if (movingLine === 0) movingLine = 6;

  return {
    upper,
    lower,
    movingLine
  };
}

export function timeCasting(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  // Earthly branch: 子1, 丑2, 寅3, 卯4, 辰5, 巳6, 午7, 未8, 申9, 酉10, 戌11, 亥12
  const yearBranch = ((year - 4) % 12 + 12) % 12 + 1;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();

  // Shichen branch: 23-1: 1 (子), 1-3: 2 (丑)...
  const hourBranch = (Math.floor((hour + 1) / 2) % 12) + 1;

  const a = yearBranch + month + day;
  const b = a + hourBranch;

  return numberCasting({ a, b, moving: b });
}

export function randomCasting() {
  const a = Math.floor(Math.random() * 999) + 1;
  const b = Math.floor(Math.random() * 999) + 1;
  const moving = Math.floor(Math.random() * 999) + 1;
  return { ...numberCasting({ a, b, moving }), randomNumbers: [a, b, moving] };
}
