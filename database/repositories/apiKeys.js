const { getDb } = require('../connection');
const { getTaiwanISOString } = require('../../utils/date');

function releaseExpiredKeyCooldowns() {
  const db = getDb();
  if (!db) return;
  const nowStr = getTaiwanISOString();
  db.prepare(`
    UPDATE api_keys
    SET status = 'active',
        cooldown_until = NULL
    WHERE status = 'cooldown'
      AND cooldown_until IS NOT NULL
      AND cooldown_until < ?
  `).run(nowStr);
}

const apiKeys = {
  getAll: () => {
    releaseExpiredKeyCooldowns();
    return getDb().prepare("SELECT * FROM api_keys ORDER BY id DESC").all();
  },
  getActiveKeys: () => {
    releaseExpiredKeyCooldowns();
    return getDb().prepare(`
      SELECT * FROM api_keys 
      WHERE status = 'active'
    `).all();
  },
  getKeyStatus: (id) => {
    releaseExpiredKeyCooldowns();
    const row = getDb().prepare("SELECT status FROM api_keys WHERE id = ?").get(id);
    return row ? row.status : null;
  },
  add: (keyValue) => {
    try {
      const stmt = getDb().prepare("INSERT INTO api_keys (key_value) VALUES (?)");
      stmt.run(keyValue);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  delete: (id) => {
    const stmt = getDb().prepare("DELETE FROM api_keys WHERE id = ?");
    stmt.run(id);
    return { success: true };
  },
  updateStatus: (id, status, errorMsg = null) => {
    const stmt = getDb().prepare(`
      UPDATE api_keys 
      SET status = ?,
          cooldown_until = CASE WHEN ? = 'cooldown' THEN cooldown_until ELSE NULL END,
          last_error_message = ? 
      WHERE id = ?
    `);
    stmt.run(status, status, errorMsg, id);
  },
  recordSuccess: (id) => {
    const nowStr = getTaiwanISOString();
    const stmt = getDb().prepare(`
      UPDATE api_keys 
      SET status = 'active',
          consecutive_failures = 0,
          last_used_at = ?,
          cooldown_until = NULL,
          last_error_message = NULL
      WHERE id = ?
    `);
    stmt.run(nowStr, id);
  },
  recordFailure: (id, errorMsg) => {
    const stmt = getDb().prepare(`
      UPDATE api_keys 
      SET status = CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'active' END,
          cooldown_until = CASE WHEN status = 'inactive' THEN cooldown_until ELSE NULL END,
          consecutive_failures = consecutive_failures + 1,
          total_errors = total_errors + 1,
          last_error_message = ?
      WHERE id = ?
    `);
    stmt.run(errorMsg, id);
    return 'active';
  },
  recordCooldown: (id, seconds = 30, errorMsg) => {
    const cooldownTime = getTaiwanISOString(new Date(Date.now() + seconds * 1000));
    const stmt = getDb().prepare(`
      UPDATE api_keys 
      SET status = 'cooldown',
          cooldown_until = ?,
          total_errors = total_errors + 1,
          last_error_message = ?
      WHERE id = ?
    `);
    stmt.run(cooldownTime, errorMsg, id);
  },
  testAllKeys: async () => {
    const keys = getDb().prepare("SELECT * FROM api_keys").all();
    const results = [];
    
    for (const key of keys) {
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key.key_value}`
          }
        });
        if (res.ok) {
          apiKeys.recordSuccess(key.id);
          results.push({ id: key.id, status: 'active', success: true });
        } else {
          const text = await res.text();
          const errorMessage = text || `HTTP ${res.status}`;
          if (res.status === 429) {
            apiKeys.recordCooldown(key.id, 30, errorMessage || '429 Rate Limit Exceeded');
            results.push({ id: key.id, status: 'cooldown', success: false, error: errorMessage });
          } else if (res.status === 401 || res.status === 403) {
            apiKeys.updateStatus(key.id, 'inactive', `HTTP ${res.status}: Key revoked/invalid`);
            results.push({ id: key.id, status: 'inactive', success: false, error: errorMessage });
          } else {
            apiKeys.recordFailure(key.id, errorMessage);
            results.push({ id: key.id, status: 'active', success: false, error: errorMessage });
          }
        }
      } catch (err) {
        apiKeys.recordFailure(key.id, err.message);
        results.push({ id: key.id, status: 'active', success: false, error: err.message });
      }
    }
    return results;
  }
};

module.exports = apiKeys;
