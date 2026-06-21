const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let db = null;

function initDatabase(dbPath) {
  if (db) return db;

  const targetPath = dbPath || path.join(process.cwd(), 'gateway.db');
  console.log(`Initializing SQLite database at: ${targetPath}`);
  
  db = new DatabaseSync(targetPath);

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS models_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT UNIQUE NOT NULL,
      priority INTEGER NOT NULL, -- 1 = primary, 2 = fallback-1, 3 = fallback-2 ...
      is_active INTEGER DEFAULT 1
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

  // 插入預設 Rules
  insertPresetRules();

  return db;
}

function insertPresetRules() {
  const checkPresets = db.prepare("SELECT COUNT(*) as count FROM rules WHERE is_preset = 1");
  const result = checkPresets.get();
  if (result.count > 0) return;

  const insert = db.prepare("INSERT INTO rules (title, content, is_preset) VALUES (?, ?, 1)");

  // 1. Angular Commit Message 規範
  insert.run(
    "Angular Commit Message 規範",
    `每個 Commit 格式必須符合: <type>(<scope>): <subject>

常用的 <type> 類型:
- feat: 新功能
- fix: 修補 bug
- docs: 文件修改
- style: 格式調整 (不影響代碼運行的空白、格式化、分號等)
- refactor: 重構 (既非新增功能也非修補 bug 的代碼修改)
- perf: 提高性能的修改
- test: 增加或修正測試代碼
- chore: 建構程序或輔助工具的變更

範例:
feat(auth): 實作 Google OAuth 登入功能
fix(gateway): 修正 429 狀態下未觸發 Key 冷卻的錯誤`
  );

  // 2. Cline/OpenCode 專案開發規範
  insert.run(
    "Cline/OpenCode 開發規範",
    `- **小步提交 (Incremental Steps)**: 每次修改控制在單一模塊，修改後立即執行測試，避免一次進行大面積修改。
- **錯誤優先排除**: 當編譯或測試失敗時，優先閱讀日誌與排查原因，不得在錯誤未解的情況下繼續寫新功能。
- **精確路徑連結**: 在回覆用戶時，涉及到的文件與代碼結構必須使用 Clickable File Links (e.g. [filename](file:///path/to/file))。
- **保留既有註釋**: 在編輯代碼時，除非特別要求，否則應完整保留無關的註釋與說明文件。`
  );

  // 3. UI/UX Pro Max 設計原則
  insert.run(
    "UI/UX Pro Max 設計原則",
    `- **色彩美學**: 禁用飽和度過高的純紅、純藍、純綠。應使用特製的和諧色調（如 HSL 微調深色系），並搭配漸變。
- **磨砂玻璃效果**: 大量運用 Backdrop Filter blur 與半透明邊框 (Border 1px solid rgba(255,255,255,0.08)) 營造高級感。
- **微動畫 (Micro-animations)**: 按鈕懸停時應有輕微的縮放 (scale(1.02))、平滑過渡 (transition 200ms) 與陰影。
- **佈局流暢度**: 保持適當的留白 (padding & gap)，使用 Inter、Outfit 等現代字體，讓排版具備呼吸感。`
  );
}

// 輔助函式庫 - API Keys
const apiKeys = {
  getAll: () => {
    return db.prepare("SELECT * FROM api_keys ORDER BY id DESC").all();
  },
  getActiveKeys: () => {
    // 撈出健康狀態且不在 cooldown 期的 key
    const nowStr = new Date().toISOString();
    return db.prepare(`
      SELECT * FROM api_keys 
      WHERE status != 'inactive' 
      AND (cooldown_until IS NULL OR cooldown_until < ?)
    `).all(nowStr);
  },
  add: (keyValue) => {
    try {
      const stmt = db.prepare("INSERT INTO api_keys (key_value) VALUES (?)");
      stmt.run(keyValue);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  delete: (id) => {
    const stmt = db.prepare("DELETE FROM api_keys WHERE id = ?");
    stmt.run(id);
    return { success: true };
  },
  updateStatus: (id, status, errorMsg = null) => {
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET status = ?, last_error_message = ? 
      WHERE id = ?
    `);
    stmt.run(status, errorMsg, id);
  },
  recordSuccess: (id) => {
    const nowStr = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET consecutive_failures = 0, last_used_at = ? 
      WHERE id = ?
    `);
    stmt.run(nowStr, id);
  },
  recordFailure: (id, errorMsg) => {
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET consecutive_failures = consecutive_failures + 1,
          total_errors = total_errors + 1,
          last_error_message = ?
      WHERE id = ?
    `);
    stmt.run(errorMsg, id);

    // 檢查是否需要禁用 (連續失敗大於等於 3 次)
    const check = db.prepare("SELECT consecutive_failures FROM api_keys WHERE id = ?").get(id);
    if (check && check.consecutive_failures >= 3) {
      db.prepare("UPDATE api_keys SET status = 'inactive' WHERE id = ?").run(id);
      return 'inactive';
    }
    return 'active';
  },
  recordCooldown: (id, seconds = 30, errorMsg) => {
    const cooldownTime = new Date(Date.now() + seconds * 1000).toISOString();
    const stmt = db.prepare(`
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
    const keys = db.prepare("SELECT * FROM api_keys").all();
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
          db.prepare("UPDATE api_keys SET status = 'active', consecutive_failures = 0, last_error_message = NULL WHERE id = ?").run(key.id);
          results.push({ id: key.id, status: 'active', success: true });
        } else {
          const text = await res.text();
          db.prepare("UPDATE api_keys SET status = 'inactive', consecutive_failures = consecutive_failures + 1, last_error_message = ? WHERE id = ?")
            .run(text || `HTTP ${res.status}`, key.id);
          results.push({ id: key.id, status: 'inactive', success: false, error: text });
        }
      } catch (err) {
        db.prepare("UPDATE api_keys SET status = 'inactive', consecutive_failures = consecutive_failures + 1, last_error_message = ? WHERE id = ?")
          .run(err.message, key.id);
        results.push({ id: key.id, status: 'inactive', success: false, error: err.message });
      }
    }
    return results;
  }
};

// 輔助函式庫 - 模型設定
const modelsConfig = {
  getAll: () => {
    return db.prepare("SELECT * FROM models_config ORDER BY priority ASC").all();
  },
  savePriorityList: (modelIds) => {
    // 傳入陣列，例如 ['meta/llama3-70b-instruct', 'meta/llama3-8b-instruct']
    // 重設所有配置
    db.exec("DELETE FROM models_config");
    const insert = db.prepare("INSERT INTO models_config (model_id, priority, is_active) VALUES (?, ?, 1)");
    modelIds.forEach((modelId, idx) => {
      insert.run(modelId, idx + 1);
    });
    return { success: true };
  },
  getAvailable: () => {
    return db.prepare("SELECT * FROM available_models ORDER BY id ASC").all();
  },
  syncFromNvidia: async (keyValue) => {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${keyValue}`
        }
      });
      if (!res.ok) {
        throw new Error(`NVIDIA API replied with HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data && Array.isArray(data.data)) {
        // 先清空原本的可用模型
        db.exec("DELETE FROM available_models");
        const insert = db.prepare("INSERT OR REPLACE INTO available_models (id, name, created) VALUES (?, ?, ?)");
        
        // 篩選 NVIDIA NIM 的模型
        data.data.forEach(m => {
          insert.run(m.id, m.id.split('/').pop(), m.created || 0);
        });

        // 預設將第一順位等自動設定（如果原本是空的）
        const check = db.prepare("SELECT COUNT(*) as count FROM models_config").get();
        if (check.count === 0 && data.data.length > 0) {
          // 找出一些常見的優秀模型先當預設
          const sorted = data.data.map(d => d.id);
          const primary = sorted.find(id => id.includes('llama3-70b') || id.includes('llama-3.1-70b')) || sorted[0];
          const fallback1 = sorted.find(id => (id.includes('llama3-8b') || id.includes('llama-3.1-8b')) && id !== primary) || sorted[1];
          const fallback2 = sorted.find(id => id.includes('mixtral') && id !== primary && id !== fallback1) || sorted[2];

          const activePresets = [primary, fallback1, fallback2].filter(Boolean);
          const insertConfig = db.prepare("INSERT INTO models_config (model_id, priority, is_active) VALUES (?, ?, 1)");
          activePresets.forEach((mId, index) => {
            insertConfig.run(mId, index + 1);
          });
        }
        return { success: true, count: data.data.length };
      }
      return { success: false, error: 'Invalid data format from NVIDIA API' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

// 輔助函式庫 - Rules
const rules = {
  getAll: () => {
    return db.prepare("SELECT * FROM rules ORDER BY is_preset DESC, id DESC").all();
  },
  add: (title, content) => {
    try {
      const stmt = db.prepare("INSERT INTO rules (title, content, is_preset) VALUES (?, ?, 0)");
      stmt.run(title, content);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  update: (id, title, content) => {
    try {
      const stmt = db.prepare("UPDATE rules SET title = ?, content = ? WHERE id = ? AND is_preset = 0");
      stmt.run(title, content, id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  delete: (id) => {
    try {
      const stmt = db.prepare("DELETE FROM rules WHERE id = ? AND is_preset = 0");
      stmt.run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

// 輔助函式庫 - 統計資訊
const stats = {
  getHourlyStats: () => {
    // 撈出最近 24 小時的統計
    return db.prepare(`
      SELECT * FROM stats 
      ORDER BY hour DESC 
      LIMIT 24
    `).all().reverse();
  },
  recordRequest: (isSuccess) => {
    const now = new Date();
    // 格式化 YYYY-MM-DD HH:00
    const pad = (n) => String(n).padStart(2, '0');
    const hourStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:00`;

    // 先插入或忽略
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

module.exports = {
  initDatabase,
  apiKeys,
  modelsConfig,
  rules,
  stats
};
