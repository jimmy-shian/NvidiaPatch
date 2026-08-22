const { getDb } = require('../connection');

let cachedSettings = null;

function parseMetadataRows(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(r.key, r.value);
  }

  return {
    ROUND_DELAY_MS: Number(map.get('ROUND_DELAY_MS') || 15000),
    REQUEST_TIMEOUT_MS: Number(map.get('REQUEST_TIMEOUT_MS') || 120000),
    STREAM_READ_TIMEOUT_MS: Number(map.get('STREAM_READ_TIMEOUT_MS') || 120000),
    NVIDIA_API_URL: map.get('NVIDIA_API_URL') || 'https://integrate.api.nvidia.com/v1',
    PORT: Number(map.get('PORT') || 4000),
    MAX_ROUNDS_PER_MODEL: Number(map.get('MAX_ROUNDS_PER_MODEL') || 2),
    MAX_EMPTY_RESPONSE_RETRIES: Number(map.get('MAX_EMPTY_RESPONSE_RETRIES') || 3),
    TEST_TIMEOUT_MS: Number(map.get('TEST_TIMEOUT_MS') || 60000),
    MODEL_FAILURE_COOLDOWN_MS: Number(map.get('MODEL_FAILURE_COOLDOWN_MS') || 60000),
    KEY_CONCURRENCY_DELAY_MS: Number(map.get('KEY_CONCURRENCY_DELAY_MS') || 5000),
    ENABLE_CONTENT_VALIDATION: map.get('ENABLE_CONTENT_VALIDATION') !== 'false',
    PRICE_PER_MILLION_PROMPT_TOKENS: Number(map.get('PRICE_PER_MILLION_PROMPT_TOKENS') || 0.30),
    PRICE_PER_MILLION_COMPLETION_TOKENS: Number(map.get('PRICE_PER_MILLION_COMPLETION_TOKENS') || 0.60),
    REF_PRICE_PER_MILLION_PROMPT_TOKENS: Number(map.get('REF_PRICE_PER_MILLION_PROMPT_TOKENS') || 5.00),
    REF_PRICE_PER_MILLION_COMPLETION_TOKENS: Number(map.get('REF_PRICE_PER_MILLION_COMPLETION_TOKENS') || 15.00),
    CURRENCY_SYMBOL: map.get('CURRENCY_SYMBOL') || 'USD'
  };
}

function refreshCache() {
  try {
    const db = getDb();
    if (!db) return;
    const rows = db.prepare("SELECT key, value FROM metadata").all();
    cachedSettings = parseMetadataRows(rows);
  } catch (_) {
    // fallback if db not ready
  }
}

const settings = {
  /**
   * 刷新記憶體快取
   */
  refreshCache,

  /**
   * 取得系統設定 — 100% 記憶體快取讀取，0 次 SQL 查詢
   */
  get() {
    if (!cachedSettings) {
      refreshCache();
    }
    return cachedSettings ? { ...cachedSettings } : parseMetadataRows([]);
  },

  /**
   * 儲存系統設定 — 僅在資料實質變更（Dirty Check）時才寫入 SQLite 並更新快取
   */
  save(config) {
    if (!cachedSettings) {
      refreshCache();
    }
    const current = cachedSettings || parseMetadataRows([]);
    const db = getDb();

    const changedKeys = [];
    const fields = [
      'ROUND_DELAY_MS',
      'REQUEST_TIMEOUT_MS',
      'STREAM_READ_TIMEOUT_MS',
      'NVIDIA_API_URL',
      'PORT',
      'MAX_ROUNDS_PER_MODEL',
      'MAX_EMPTY_RESPONSE_RETRIES',
      'TEST_TIMEOUT_MS',
      'MODEL_FAILURE_COOLDOWN_MS',
      'KEY_CONCURRENCY_DELAY_MS',
      'ENABLE_CONTENT_VALIDATION',
      'PRICE_PER_MILLION_PROMPT_TOKENS',
      'PRICE_PER_MILLION_COMPLETION_TOKENS',
      'REF_PRICE_PER_MILLION_PROMPT_TOKENS',
      'REF_PRICE_PER_MILLION_COMPLETION_TOKENS',
      'CURRENCY_SYMBOL'
    ];

    for (const field of fields) {
      if (config[field] !== undefined) {
        const newValStr = String(config[field]);
        const curValStr = String(current[field]);
        if (newValStr !== curValStr) {
          changedKeys.push({ key: field, value: newValStr });
        }
      }
    }

    // 髒值檢查（Dirty Check）：若無任何實質變更，0 次 SQLite 寫入
    if (changedKeys.length === 0) {
      return this.get();
    }

    const stmt = db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)");
    try {
      db.exec("BEGIN TRANSACTION");
      for (const item of changedKeys) {
        stmt.run(item.key, item.value);
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (_) {}
      throw err;
    }

    // 更新記憶體快取
    refreshCache();
    return this.get();
  }
};

module.exports = settings;

