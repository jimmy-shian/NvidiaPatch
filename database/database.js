const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { setDb, getDb } = require('./connection');

// Repositories & In-Memory Stores
const apiKeys = require('./repositories/apiKeys');
const modelsConfig = require('./repositories/modelsConfig');
const rules = require('./repositories/rules');
const stats = require('./repositories/stats');
const settings = require('./repositories/settings');
const tokenUsage = require('./repositories/tokenUsage');

// 資料庫初始化是否完整完成（避免半初始化狀態被誤判為可用）
let dbReady = false;

// ensureDatabase 的重試參數：開機時 DB 可能被尚未完全釋放的前一次實例暫時佔用
const DB_INIT_MAX_ATTEMPTS = 4;
const DB_INIT_RETRY_DELAYS_MS = [300, 800, 2000, 4000];

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 資料庫是否處於「完整可用」狀態：
 *  1. 初始化流程完整跑完（含 schema 遷移與記憶體快取預載）
 *  2. handle 存在且可執行查詢
 */
function isDatabaseReady() {
  if (!dbReady) return false;
  try {
    const db = getDb();
    if (!db) return false;
    db.prepare('SELECT 1 AS ok').get();
    return true;
  } catch (_) {
    return false;
  }
}

function initDatabase(dbPath, options = {}) {
  const forceReinit = options && options.force === true;

  // 已就緒且未要求強制重建 → 直接回傳現有 handle（冪等）
  if (!forceReinit && isDatabaseReady()) {
    try {
      return getDb();
    } catch (_) {}
  }

  // 清掉可能半初始化的舊 handle，確保重試是乾淨的重新初始化
  try {
    closeDatabase();
  } catch (_) {}

  dbReady = false;

  const resolvedPath = dbPath || path.join(__dirname, '..', 'gateway.db');
  const dbDir = path.dirname(resolvedPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  console.log('Initializing SQLite database at:', resolvedPath);

  const db = new DatabaseSync(resolvedPath);
  setDb(db);

  try {
    // 1. 配置 SQLite 效能與硬體保護 PRAGMA
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -16384;
    `);

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
  } catch (err) {
    // 任一步驟失敗都要完整回滾，避免留下不可用的半初始化 handle
    console.error('Database initialization failed, rolling back:', err.message);
    try {
      closeDatabase();
    } catch (_) {}
    throw err;
  }

  dbReady = true;
  return db;
}

/**
 * 確保資料庫可用（冪等）：
 *  - 已就緒 → 直接回傳 true
 *  - 未就緒 → 帶指數退避重試 initDatabase（最多 4 次）
 *
 * 用於「啟動時偶發抓不到資料庫」與「重新啟動 Gateway 後仍抓不到」兩類情境：
 * 前一次實例若尚未完全釋放 SQLite 鎖，短暫退避後重試通常即可恢復。
 * closeDatabase 中已先執行 WAL checkpoint 再 close，可大幅降低 Windows 上的鎖殘留機率。
 *
 * @param {string} dbPath
 * @returns {Promise<boolean>} 資料庫是否就緒
 */
async function ensureDatabase(dbPath) {
  if (isDatabaseReady()) return true;

  let lastErr = null;
  for (let attempt = 1; attempt <= DB_INIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      initDatabase(dbPath, { force: true });
      if (isDatabaseReady()) {
        console.log(`[Database] 就緒（第 ${attempt}/${DB_INIT_MAX_ATTEMPTS} 次嘗試）`);
        return true;
      }
    } catch (err) {
      lastErr = err;
      console.error(`[Database] 初始化失敗（第 ${attempt}/${DB_INIT_MAX_ATTEMPTS} 次嘗試）：${err.message}`);
    }
    if (attempt < DB_INIT_MAX_ATTEMPTS) {
      await sleepMs(DB_INIT_RETRY_DELAYS_MS[attempt - 1] || 1000);
    }
  }

  if (lastErr) {
    console.error(`[Database] 重試 ${DB_INIT_MAX_ATTEMPTS} 次後仍無法就緒：${lastErr.message}`);
  }
  return false;
}

function closeDatabase() {
  try {
    const db = getDb();
    if (db) {
      // 關閉前先 checkpoint WAL，確保 Windows 上 WAL/SHM 檔案鎖能被完整釋放，
      // 避免下一次 initDatabase 時因 WAL 鎖殘留而拋出 "unable to open database file"
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (_) {}
      try {
        db.close();
      } catch (e) {
        console.error('Error closing database:', e.message);
      }
      setDb(null);
    }
  } catch (_) {}
  dbReady = false;
}

module.exports = {
  initDatabase,
  ensureDatabase,
  isDatabaseReady,
  closeDatabase,
  getDb,
  apiKeys,
  modelsConfig,
  rules,
  stats,
  settings,
  tokenUsage
};
