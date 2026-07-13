const { getDb } = require('../connection');
const { getTaiwanHourString } = require('../../utils/date');

const stats = {
  getHourlyStats: () => {
    return getDb().prepare(`
      SELECT * FROM stats 
      ORDER BY hour DESC 
      LIMIT 24
    `).all().reverse();
  },
  recordRequest: (isSuccess) => {
    const db = getDb();
    const hourStr = getTaiwanHourString();

    db.prepare("INSERT OR IGNORE INTO stats (hour, request_count, success_count, error_count) VALUES (?, 0, 0, 0)").run(hourStr);

    if (isSuccess) {
      db.prepare(`
        UPDATE stats 
        SET request_count = request_count + 1,
            success_count = success_count + 1
        WHERE hour = ?
      `).run(hourStr);
    } else {
      db.prepare(`
        UPDATE stats 
        SET request_count = request_count + 1,
            error_count = error_count + 1
        WHERE hour = ?
      `).run(hourStr);
    }
  }
};

module.exports = stats;
