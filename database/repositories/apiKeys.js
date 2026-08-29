const { getDb } = require('../connection');
const { getTaiwanISOString } = require('../../utils/date');

// 持久化 Key 配置記憶體快取：Map<id, { id, key_value, status }>
const cachedKeys = new Map();
let isCacheLoaded = false;

// 暫態 Runtime 狀態（100% RAM，重啟歸零）：Map<id, { cooldownUntil: number|null, consecutiveFailures: number, totalErrors: number, lastError: string|null, lastUsedAt: string|null }>
const apiKeyRuntimeState = new Map();

function ensureCacheLoaded() {
  if (isCacheLoaded) return;
  refreshCache();
}

function refreshCache() {
  try {
    const db = getDb();
    if (!db) return;
    const rows = db.prepare("SELECT id, key_value, status FROM api_keys ORDER BY id DESC").all();
    cachedKeys.clear();
    for (const row of rows) {
      cachedKeys.set(row.id, {
        id: row.id,
        key_value: row.key_value,
        status: row.status || 'active'
      });
    }
    isCacheLoaded = true;
  } catch (_) {
    // ignore
  }
}

function getRuntimeState(id) {
  let state = apiKeyRuntimeState.get(id);
  if (!state) {
    state = {
      cooldownUntil: null,
      consecutiveFailures: 0,
      totalErrors: 0,
      lastError: null,
      lastUsedAt: null
    };
    apiKeyRuntimeState.set(id, state);
  }
  return state;
}

/**
 * 結合持久配置與暫態 Runtime 狀態（惰性過期 Lazy Expiration，0 次 SQL 寫入）
 */
function getEffectiveKeyRow(persistentKey) {
  const runtime = getRuntimeState(persistentKey.id);
  const now = Date.now();

  let effectiveStatus = persistentKey.status || 'active';
  let cooldownUntilStr = null;

  if (effectiveStatus !== 'inactive') {
    if (runtime.cooldownUntil && runtime.cooldownUntil > now) {
      effectiveStatus = 'cooldown';
      cooldownUntilStr = getTaiwanISOString(new Date(runtime.cooldownUntil));
    } else if (runtime.cooldownUntil && runtime.cooldownUntil <= now) {
      // 惰性過期：過期直接在記憶體抹除，不觸發任何 SQL UPDATE
      runtime.cooldownUntil = null;
    }
  }

  return {
    id: persistentKey.id,
    key_value: persistentKey.key_value,
    status: effectiveStatus,
    consecutive_failures: runtime.consecutiveFailures || 0,
    total_errors: runtime.totalErrors || 0,
    last_used_at: runtime.lastUsedAt || null,
    cooldown_until: cooldownUntilStr,
    last_error_message: runtime.lastError || null
  };
}

const apiKeys = {
  /**
   * 刷新記憶體快取
   */
  refreshCache,

  /**
   * 取得所有 API Keys（記憶體快取 + 暫態合併，0 次 SQL 查詢/寫入）
   */
  getAll: () => {
    ensureCacheLoaded();
    const result = [];
    for (const key of cachedKeys.values()) {
      result.push(getEffectiveKeyRow(key));
    }
    result.sort((a, b) => b.id - a.id);
    return result;
  },

  /**
   * 取得所有處於 Active 狀態且未在冷卻中的 API Keys（0 次 SQL 查詢/寫入）
   */
  getActiveKeys: () => {
    ensureCacheLoaded();
    const result = [];
    for (const key of cachedKeys.values()) {
      if (key.status === 'inactive') continue;
      const effective = getEffectiveKeyRow(key);
      if (effective.status === 'active') {
        result.push(effective);
      }
    }
    return result;
  },

  /**
   * 取得單一 Key 的目前狀態（0 次 SQL 查詢）
   */
  getKeyStatus: (id) => {
    ensureCacheLoaded();
    const key = cachedKeys.get(Number(id));
    if (!key) return null;
    const effective = getEffectiveKeyRow(key);
    return effective.status;
  },

  /**
   * 新增 API Key — 使用者配置變更，寫入 SQLite 並更新快取
   */
  add: (keyValue) => {
    try {
      const stmt = getDb().prepare("INSERT INTO api_keys (key_value, status) VALUES (?, 'active')");
      const info = stmt.run(keyValue);
      const newId = Number(info.lastInsertRowid);
      cachedKeys.set(newId, {
        id: newId,
        key_value: keyValue,
        status: 'active'
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * 刪除 API Key — 使用者配置變更，寫入 SQLite 並更新快取
   */
  delete: (id) => {
    const numId = Number(id);
    const stmt = getDb().prepare("DELETE FROM api_keys WHERE id = ?");
    stmt.run(numId);
    cachedKeys.delete(numId);
    apiKeyRuntimeState.delete(numId);
    return { success: true };
  },

  /**
   * 使用者手動或嚴重錯誤停用 Key — 寫入 SQLite 並更新快取
   */
  updateStatus: (id, status, errorMsg = null) => {
    const numId = Number(id);
    const stmt = getDb().prepare(`
      UPDATE api_keys 
      SET status = ?,
          last_error_message = ? 
      WHERE id = ?
    `);
    stmt.run(status, errorMsg, numId);

    const cached = cachedKeys.get(numId);
    if (cached) {
      cached.status = status;
    }
    const runtime = getRuntimeState(numId);
    if (status !== 'cooldown') {
      runtime.cooldownUntil = null;
    }
    if (errorMsg) {
      runtime.lastError = errorMsg;
    }
  },

  /**
   * 記錄請求成功 — 100% 純記憶體 Runtime 更新，0 次 SQL 寫入
   */
  recordSuccess: (id) => {
    const numId = Number(id);
    const runtime = getRuntimeState(numId);
    runtime.consecutiveFailures = 0;
    runtime.cooldownUntil = null;
    runtime.lastError = null;
    runtime.lastUsedAt = getTaiwanISOString();
  },

  /**
   * 記錄暫時性失敗 — 100% 純記憶體 Runtime 更新，0 次 SQL 寫入
   */
  recordFailure: (id, errorMsg) => {
    const numId = Number(id);
    const runtime = getRuntimeState(numId);
    runtime.consecutiveFailures += 1;
    runtime.totalErrors += 1;
    runtime.lastError = errorMsg || null;
    return 'active';
  },

  /**
   * 進入暫態冷卻 — 100% 純記憶體 Runtime 更新，0 次 SQL 寫入
   */
  recordCooldown: (id, seconds = 30, errorMsg) => {
    const numId = Number(id);
    const runtime = getRuntimeState(numId);
    runtime.cooldownUntil = Date.now() + seconds * 1000;
    runtime.totalErrors += 1;
    runtime.lastError = errorMsg || null;
  },

  /**
   * 手動測試所有 API Key
   */
  testAllKeys: async () => {
    ensureCacheLoaded();
    const keys = Array.from(cachedKeys.values());
    const results = [];
    const settings = require('./settings');
    const { resolveModelsCheckUrl } = require('../../gateway/utils/urlHelper');
    const rawBaseUrl = settings.get().NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const targetUrl = resolveModelsCheckUrl(rawBaseUrl);

    for (const key of keys) {
      try {
        const res = await fetch(targetUrl, {
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

