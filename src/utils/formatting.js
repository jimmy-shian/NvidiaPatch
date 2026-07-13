export const formatTaiwanParts = (value) => {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    return formatter.formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
  } catch (e) {
    console.error('formatTaiwanParts error:', e);
    return null;
  }
};

export const formatTaiwanTime = (value) => {
  if (!value) return '--';
  const parts = formatTaiwanParts(value);
  if (!parts) {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '--';
      return date.toLocaleTimeString('zh-TW', { hourCycle: 'h23' });
    } catch (err) {
      return typeof value === 'string' && value.length >= 19 ? value.substring(11, 19) : String(value);
    }
  }
  return `${parts.hour}:${parts.minute}:${parts.second}`;
};

export const formatTaiwanDateTime = (value) => {
  if (!value) return '--';
  const parts = formatTaiwanParts(value);
  if (!parts) {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '--';
      return date.toLocaleString('zh-TW', { hourCycle: 'h23' });
    } catch (err) {
      return String(value);
    }
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

export const formatSyncTime = (isoString, language, defaultLocale = 'zh-TW') => {
  if (!isoString) return '--';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--';

  let locale = defaultLocale;
  if (language) {
    if (language.startsWith('ja')) {
      locale = 'ja-JP';
    } else if (language.startsWith('en')) {
      locale = 'en-US';
    } else if (language.startsWith('zh')) {
      locale = 'zh-TW';
    } else {
      locale = language;
    }
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Taipei'
    }).format(date);
  } catch (e) {
    return date.toLocaleString();
  }
};
