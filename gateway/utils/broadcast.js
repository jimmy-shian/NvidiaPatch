const eventManager = require('../sse/eventManager');

function broadcastEvent(eventName, payload) {
  try {
    eventManager.broadcast(eventName, payload);
  } catch (err) {
    // 廣播錯誤不應中斷主流程
  }
}

module.exports = {
  broadcastEvent
};
