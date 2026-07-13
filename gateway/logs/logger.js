const eventManager = require('../sse/eventManager');
const { getTaiwanISOString } = require('../../utils/date');

const activeLogs = [];

function addLog(type, message) {
  const logEntry = {
    timestamp: getTaiwanISOString(),
    type, // 'info', 'success', 'warning', 'error'
    message
  };

  activeLogs.push(logEntry);
  if (activeLogs.length > 100) {
    activeLogs.shift();
  }

  console.log(`[Gateway Log] [${type.toUpperCase()}] ${message}`);

  eventManager.broadcast('logs', logEntry);
}

module.exports = {
  activeLogs,
  addLog
};
