function runMigrations(db) {
  // 1. 建立 api_keys 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active', -- active, cooldown, inactive
      consecutive_failures INTEGER DEFAULT 0,
      total_errors INTEGER DEFAULT 0,
      last_used_at TEXT,
      cooldown_until TEXT,
      last_error_message TEXT
    )
  `);

  // 2. 建立 models_config 表
  // group_id 用於保存三組模型順位設定，使用者可在 UI 直接切換目前啟用組別
  db.exec(`
    CREATE TABLE IF NOT EXISTS models_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER DEFAULT 1, -- 1~3 = 三組可切換的模型順位設定
      model_id TEXT NOT NULL,
      priority INTEGER NOT NULL, -- 1 = primary, 2 = fallback-1, 3 = fallback-2 ...
      is_active INTEGER DEFAULT 1,
      UNIQUE(group_id, model_id)
    )
  `);

  // 3. 建立 available_models 表 (NVIDIA 同步過來的模型)
  db.exec(`
    CREATE TABLE IF NOT EXISTS available_models (
      id TEXT PRIMARY KEY,
      name TEXT,
      created INTEGER
    )
  `);

  // 4. 建立 rules 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_preset INTEGER DEFAULT 0
    )
  `);

  // 5. 建立 stats 表 (每小時彙整)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour TEXT UNIQUE NOT NULL, -- Format: YYYY-MM-DD HH:00
      request_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0
    )
  `);

  // 6. 建立 metadata 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // 7. 建立 token_usage 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      timestamp TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      request_body TEXT DEFAULT '',
      response_content TEXT DEFAULT ''
    )
  `);

  // 7.1 確保舊表缺少 request_body 或 response_content 欄位時自動補上
  try {
    const tokenUsageCols = db.prepare("PRAGMA table_info(token_usage)").all();
    if (!tokenUsageCols.some(c => c.name === 'request_body')) {
      db.exec("ALTER TABLE token_usage ADD COLUMN request_body TEXT DEFAULT ''");
    }
    if (!tokenUsageCols.some(c => c.name === 'response_content')) {
      db.exec("ALTER TABLE token_usage ADD COLUMN response_content TEXT DEFAULT ''");
    }
  } catch (_) { /* ignore */ }

  // 確保初始設定參數存在於 metadata 中
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('ROUND_DELAY_MS', '15000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('REQUEST_TIMEOUT_MS', '120000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('STREAM_READ_TIMEOUT_MS', '120000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('NVIDIA_API_URL', 'https://integrate.api.nvidia.com/v1')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('PORT', '4000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('MAX_ROUNDS_PER_MODEL', '2')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('TEST_TIMEOUT_MS', '60000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('MODEL_FAILURE_COOLDOWN_MS', '60000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('KEY_CONCURRENCY_DELAY_MS', '5000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_PROMPT_TOKENS', '0.30')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_COMPLETION_TOKENS', '0.60')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('CURRENCY_SYMBOL', 'USD')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_PROMPT_TOKENS', '5.00')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_COMPLETION_TOKENS', '15.00')").run();

  // 確保舊版資料庫可平滑升級到三組模型順位 schema
  ensureModelsConfigSchema(db);

  // 插入預設 Rules
  const { insertPresetRules } = require('./presetRules');
  insertPresetRules(db);
}

function ensureModelsConfigSchema(db) {
  const tableInfo = db.prepare("PRAGMA table_info(models_config)").all();
  const hasGroupId = tableInfo.some(col => col.name === 'group_id');
  const tableRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'models_config'").get();
  const tableSql = tableRow && tableRow.sql ? tableRow.sql : '';
  const hasLegacyUniqueModelId = /model_id\s+TEXT\s+UNIQUE/i.test(tableSql);
  const hasGroupUnique = /UNIQUE\s*\(\s*group_id\s*,\s*model_id\s*\)/i.test(tableSql);

  if (!hasGroupId || hasLegacyUniqueModelId || !hasGroupUnique) {
    console.log('Migrating models_config table to grouped priority schema...');
    const rows = hasGroupId
      ? db.prepare("SELECT group_id, model_id, priority, is_active FROM models_config ORDER BY group_id ASC, priority ASC").all()
      : db.prepare("SELECT 1 AS group_id, model_id, priority, is_active FROM models_config ORDER BY priority ASC").all();

    db.exec("DROP TABLE IF EXISTS models_config_new");
    db.exec(`
      CREATE TABLE models_config_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER DEFAULT 1,
        model_id TEXT NOT NULL,
        priority INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1,
        UNIQUE(group_id, model_id)
      )
    `);

    const insert = db.prepare("INSERT OR IGNORE INTO models_config_new (group_id, model_id, priority, is_active) VALUES (?, ?, ?, ?)");
    const priorityByGroup = new Map();
    rows.forEach((row) => {
      const groupId = normalizeModelGroupId(row.group_id || 1);
      const nextPriority = (priorityByGroup.get(groupId) || 0) + 1;
      priorityByGroup.set(groupId, nextPriority);
      insert.run(groupId, row.model_id, nextPriority, row.is_active === 0 ? 0 : 1);
    });

    db.exec(`
      DROP TABLE models_config;
      ALTER TABLE models_config_new RENAME TO models_config;
    `);
  }

  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('active_model_group', '1')").run();
}

function normalizeModelGroupId(groupId) {
  const parsed = Number.parseInt(groupId, 10);
  if ([1, 2, 3].includes(parsed)) return parsed;
  return 1;
}

module.exports = {
  runMigrations
};
