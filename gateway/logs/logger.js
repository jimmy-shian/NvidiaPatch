const eventManager = require('../sse/eventManager');
const { getTaiwanISOString } = require('../../utils/date');

const activeLogs = [];
const MAX_ACTIVE_LOGS = 100;

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  warning: 30,
  error: 40
};

let currentLogLevel = LOG_LEVELS.info;

function setLogLevel(level) {
  if (LOG_LEVELS[level.toLowerCase()]) {
    currentLogLevel = LOG_LEVELS[level.toLowerCase()];
  }
}

function formatConsoleMessage(level, message, meta = {}) {
  const timestamp = getTaiwanISOString();
  const reqPart = meta.requestId ? ` [Req: ${meta.requestId}]` : '';
  const metaPart = Object.keys(meta).filter(k => k !== 'requestId').length > 0
    ? ` ${JSON.stringify(meta, (k, v) => (k === 'stack' ? undefined : v))}`
    : '';
  return `[${timestamp}] [${level.toUpperCase()}]${reqPart} ${message}${metaPart}`;
}

function log(level, message, meta = {}) {
  const normalizedLevel = level === 'warning' ? 'warn' : level;
  const numericLevel = LOG_LEVELS[normalizedLevel] || LOG_LEVELS.info;
  
  if (numericLevel < currentLogLevel) return;

  const logEntry = {
    timestamp: getTaiwanISOString(),
    type: level === 'warn' ? 'warning' : level, // 'info', 'warning', 'error', 'success'
    message: String(message),
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {})
  };

  // 儲存於記憶體即時日誌池供前端 SSE 初始與持續消費
  activeLogs.push(logEntry);
  if (activeLogs.length > MAX_ACTIVE_LOGS) {
    activeLogs.shift();
  }

  // 輸出結構化主控台日誌
  const formatted = formatConsoleMessage(normalizedLevel, message, meta);
  if (normalizedLevel === 'error') {
    console.error(formatted);
    if (meta.stack) {
      console.error(meta.stack);
    }
  } else if (normalizedLevel === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // 即時廣播至 SSE 客戶端
  try {
    eventManager.broadcast('logs', logEntry);
  } catch (_) {
    // 忽略廣播非同步例外
  }
}

const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  warning: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  success: (msg, meta) => log('success', msg, meta),
  setLogLevel
};

function addLog(type, message, meta) {
  log(type, message, meta);
}

module.exports = {
  logger,
  activeLogs,
  addLog,
  setLogLevel
};
