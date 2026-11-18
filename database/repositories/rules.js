const { getDb } = require('../connection');

let cachedRules = null;

function refreshCache() {
  let db = null;
  try {
    db = getDb();
  } catch (_) {
    cachedRules = null;
    return;
  }
  if (!db) {
    cachedRules = null;
    return;
  }
  try {
    const rows = db.prepare("SELECT * FROM rules ORDER BY is_preset DESC, id DESC").all();
    cachedRules = rows || [];
  } catch (err) {
    cachedRules = null;
    console.error('[rules] Failed to refresh cache:', err.message);
  }
}

function ensureCacheLoaded() {
  if (!cachedRules) {
    refreshCache();
  }
}

const rules = {
  /**
   * 刷新記憶體快取
   */
  refreshCache,

  /**
   * 取得所有規則（100% 記憶體快取讀取，0 次 SQL 查詢）
   */
  getAll: () => {
    ensureCacheLoaded();
    return (cachedRules || []).map(r => ({ ...r }));
  },

  /**
   * 新增自訂規則 — 寫入 SQLite 並更新快取
   */
  add: (title, content) => {
    try {
      const stmt = getDb().prepare("INSERT INTO rules (title, content, is_preset) VALUES (?, ?, 0)");
      stmt.run(title, content);
      refreshCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * 更新自訂規則 — 寫入 SQLite 並更新快取
   */
  update: (id, title, content) => {
    try {
      const numId = Number(id);
      const stmt = getDb().prepare("UPDATE rules SET title = ?, content = ? WHERE id = ? AND is_preset = 0");
      stmt.run(title, content, numId);
      refreshCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * 刪除自訂規則 — 寫入 SQLite 並更新快取
   */
  delete: (id) => {
    try {
      const numId = Number(id);
      const stmt = getDb().prepare("DELETE FROM rules WHERE id = ? AND is_preset = 0");
      stmt.run(numId);
      refreshCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = rules;

