"use strict";

/**
 * 取得台灣時間 (Asia/Taipei, UTC+8) 的 DateTime 元件
 * @param {Date} [date=new Date()] 指定的日期時間，預設為現在
 * @returns {Object} 轉換後的年、月、日、時、分、秒元件
 */
exports.getTaiwanDateParts = function getTaiwanDateParts(date = new Date()) {
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
};

/**
 * 取得台灣時間 ISO 格式字串，帶 +08:00 时区
 * @param {Date} [date=new Date()] 指定的日期時間，預設為現在
 * @returns {string} ISO 格式時間字串，例如 "YYYY-MM-DDTHH:MM:SS+08:00"
 */
exports.getTaiwanISOString = function getTaiwanISOString(date = new Date()) {
  const parts = exports.getTaiwanDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
};

/**
 * 取得台灣時間每小時區間的 key 字串，適合統計時彙整用
 * @param {Date} [date=new Date()] 指定的日期時間，預設為現在
 * @returns {string} 格式如 "YYYY-MM-DD HH:00" 的時間字串
 */
exports.getTaiwanHourString = function getTaiwanHourString(date = new Date()) {
  const parts = exports.getTaiwanDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`;
};