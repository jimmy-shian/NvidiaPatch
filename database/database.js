const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { setDb, getDb } = require('./connection');

// Repositories & In-Memory Stores
const apiKeys = require('./repositories/apiKeys');
const modelsConfig = require('./repositories/modelsConfig');
const rules = require('./repositories/rules');
const stats = require('./repositories/stats');
const settings = require('./repositories/settings');
const tokenUsage = require('./repositories/tokenUsage');

function initDatabase(dbPath) {
  try {
    const existing = getDb();
    if (existing) return existing;
  } catch (_) {}
  
  const resolvedPath = dbPath || path.join(__dirname, '..', 'gateway.db');
  console.log('Initializing SQLite database at:', resolvedPath);
  
  const db = new DatabaseSync(resolvedPath);
  setDb(db);
  
  // 1. 配置 SQLite 效能與硬體保護 PRAGMA
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -16384;
    `);
  } catch (pragmaErr) {
    console.error('Failed to set SQLite PRAGMAs:', pragmaErr.message);
  }

  // 2. 執行 Schema 遷移
  const { runMigrations } = require('./schema/schemaManager');
  runMigrations(db);

  // 3. 啟動時一次性預載持久配置至記憶體快取（RAM Cache）
  settings.refreshCache();
  apiKeys.refreshCache();
  modelsConfig.refreshCache();
  rules.refreshCache();

  // 4. 重設暫態 Runtime 狀態（重啟清空）
  stats.reset();
  tokenUsage.clear();
  
  return db;
}

function closeDatabase() {
  try {
    const db = getDb();
    if (db) {
      try {
        db.close();
      } catch (e) {
        console.error('Error closing database:', e.message);
      }
      setDb(null);
    }
  } catch (_) {}
}

module.exports = {
  initDatabase,
  closeDatabase,
  getDb,
  apiKeys,
  modelsConfig,
  rules,
  stats,
  settings,
  tokenUsage
};

