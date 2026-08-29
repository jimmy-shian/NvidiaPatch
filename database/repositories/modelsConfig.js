const { getDb } = require('../connection');
const { getTaiwanISOString } = require('../../utils/date');
const { fetchNvidiaIntegrateModelsCatalog } = require('../crawler/nvidiaIntegrateCrawler');
const { fetchNvidiaBuildFreeEndpointCatalog } = require('../crawler/nvidiaBuildCrawler');
const { fetchNvidiaFeaturedModelsCatalog } = require('../crawler/nvidiaFeaturedCrawler');

function normalizeModelGroupId(groupId) {
  const parsed = Number.parseInt(groupId, 10);
  if ([1, 2, 3].includes(parsed)) return parsed;
  return 1;
}

// 記憶體快取
let cachedActiveGroup = 1;
const cachedGroupModels = new Map(); // groupId -> Array<model>
let cachedAvailableModels = [];
let cachedSyncMeta = {
  lastTime: null,
  lastSource: null,
  expectedCount: null,
  parsedCount: null,
  savedCount: null
};
let isModelsCacheLoaded = false;

function ensureCacheLoaded() {
  if (isModelsCacheLoaded) return;
  refreshCache();
}

function refreshCache() {
  try {
    const db = getDb();
    if (!db) return;

    // 1. 載入 active_model_group
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'active_model_group'").get();
      cachedActiveGroup = normalizeModelGroupId(row ? row.value : 1);
    } catch (_) {
      cachedActiveGroup = 1;
    }

    // 2. 載入三組模型順位
    cachedGroupModels.clear();
    for (const g of [1, 2, 3]) {
      const rows = db.prepare("SELECT * FROM models_config WHERE group_id = ? ORDER BY priority ASC").all(g);
      cachedGroupModels.set(g, rows || []);
    }

    // 3. 載入可用模型清單
    const availRows = db.prepare("SELECT * FROM available_models ORDER BY id ASC").all();
    cachedAvailableModels = availRows || [];

    // 4. 載入同步 metadata
    const metaRows = db.prepare("SELECT key, value FROM metadata WHERE key LIKE 'last_model_sync_%'").all();
    const metaMap = new Map((metaRows || []).map(r => [r.key, r.value]));
    
    const expCount = Number(metaMap.get('last_model_sync_expected_count'));
    const prsCount = Number(metaMap.get('last_model_sync_parsed_count'));
    const svdCount = Number(metaMap.get('last_model_sync_saved_count'));

    cachedSyncMeta = {
      lastTime: metaMap.get('last_model_sync_time') || null,
      lastSource: metaMap.get('last_model_sync_source') || null,
      expectedCount: Number.isFinite(expCount) && expCount > 0 ? expCount : null,
      parsedCount: Number.isFinite(prsCount) && prsCount >= 0 ? prsCount : null,
      savedCount: Number.isFinite(svdCount) && svdCount >= 0 ? svdCount : null
    };

    isModelsCacheLoaded = true;
  } catch (_) {
    // ignore
  }
}

async function fetchModelsFromEndpoint(baseUrl, keyValue = null) {
  const cleanBase = (baseUrl || 'https://integrate.api.nvidia.com/v1').trim().replace(/\/+$/, '');

  // 建立候選端點清單（涵蓋 OpenAI 標準、Ollama /api/tags 與 /v1/models、LM Studio /api/v0/models 與 /v1/models）
  const candidateUrls = [];
  if (cleanBase.endsWith('/v1')) {
    candidateUrls.push(`${cleanBase}/models`);
    const rootBase = cleanBase.replace(/\/v1$/, '');
    candidateUrls.push(`${rootBase}/api/tags`);
    candidateUrls.push(`${rootBase}/api/v0/models`);
    candidateUrls.push(`${rootBase}/models`);
  } else {
    candidateUrls.push(`${cleanBase}/models`);
    candidateUrls.push(`${cleanBase}/v1/models`);
    candidateUrls.push(`${cleanBase}/api/tags`);
    candidateUrls.push(`${cleanBase}/api/v0/models`);
  }

  const uniqueUrls = [...new Set(candidateUrls)];
  let lastError = null;

  for (const targetUrl of uniqueUrls) {
    try {
      const headers = {
        'Accept': 'application/json, text/plain, */*'
      };
      if (keyValue && keyValue !== 'local-key') {
        headers['Authorization'] = `Bearer ${keyValue}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      let response;
      try {
        response = await fetch(targetUrl, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = new Error(`無法連接端點 ${targetUrl}：${err.message}`);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        lastError = new Error(`端點回傳 HTTP ${response.status} (${targetUrl})`);
        continue;
      }

      const data = await response.json().catch(() => null);
      if (!data) continue;

      let rawList = [];
      if (Array.isArray(data)) {
        rawList = data;
      } else if (Array.isArray(data.data)) {
        rawList = data.data;
      } else if (Array.isArray(data.models)) {
        rawList = data.models;
      }

      const seen = new Set();
      const models = [];
      rawList.forEach((m) => {
        let modelId = '';
        let modelName = '';
        let created = 0;

        if (typeof m === 'string' && m.trim()) {
          modelId = m.trim();
          modelName = modelId.split('/').pop();
        } else if (m && typeof m === 'object') {
          // 支援 Ollama (name / model), OpenAI (id / name), LM Studio (id / path)
          modelId = (typeof m.id === 'string' && m.id.trim())
            || (typeof m.model === 'string' && m.model.trim())
            || (typeof m.name === 'string' && m.name.trim())
            || '';
          modelName = (typeof m.name === 'string' && m.name.trim())
            || (typeof m.id === 'string' && m.id.trim())
            || (modelId ? modelId.split('/').pop() : '');
          created = Number.isFinite(Number(m.created))
            ? Number(m.created)
            : (m.modified_at ? Math.floor(new Date(m.modified_at).getTime() / 1000) : 0);
        }

        if (!modelId || seen.has(modelId)) return;
        seen.add(modelId);
        models.push({
          id: modelId,
          name: modelName || modelId.split('/').pop(),
          created: created || 0
        });
      });

      if (models.length > 0) {
        return {
          models,
          expectedCount: models.length,
          source: targetUrl
        };
      }
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error(`無法從 ${cleanBase} 解析到任何有效模型。`);
}

const modelsConfig = {
  /**
   * 刷新記憶體快取
   */
  refreshCache,

  /**
   * 取得目前啟用的模型組別（100% 記憶體快取讀取，0 次 SQL 查詢）
   */
  getActiveGroup: () => {
    ensureCacheLoaded();
    return cachedActiveGroup;
  },

  /**
   * 切換目前啟用的模型組別 — 僅在組別變更時寫入 SQLite
   */
  setActiveGroup: (groupId) => {
    ensureCacheLoaded();
    const normalizedGroupId = normalizeModelGroupId(groupId);

    // 髒值檢查（Dirty Check）
    if (normalizedGroupId === cachedActiveGroup) {
      return { success: true, activeGroup: normalizedGroupId };
    }

    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('active_model_group', ?)").run(String(normalizedGroupId));
    cachedActiveGroup = normalizedGroupId;
    return { success: true, activeGroup: normalizedGroupId };
  },

  /**
   * 取得特定組別的模型順位清單（100% 記憶體快取讀取，0 次 SQL 查詢）
   */
  getAll: (groupId = null) => {
    ensureCacheLoaded();
    const targetGroupId = groupId === null ? cachedActiveGroup : normalizeModelGroupId(groupId);
    const list = cachedGroupModels.get(targetGroupId) || [];
    return list.map(m => ({ ...m }));
  },

  /**
   * 取得三組模型組別完整概況（100% 記憶體快取讀取，0 次 SQL 查詢）
   */
  getGroups: () => {
    ensureCacheLoaded();
    const activeGroup = cachedActiveGroup;
    const groups = [1, 2, 3].map((groupId) => {
      const models = (cachedGroupModels.get(groupId) || []).map(m => ({ ...m }));
      return {
        group_id: groupId,
        is_active_group: groupId === activeGroup,
        models,
        count: models.length,
        primary_model: models[0] ? models[0].model_id : null
      };
    });
    return { activeGroup, groups };
  },

  /**
   * 儲存特定組別的模型順位 — 僅在實質內容變更（Dirty Check）時寫入 SQLite
   */
  savePriorityList: (modelIds, groupId = null) => {
    ensureCacheLoaded();
    const targetGroupId = groupId === null ? cachedActiveGroup : normalizeModelGroupId(groupId);
    const uniqueModelIds = [...new Set((modelIds || []).filter(Boolean))];

    // 髒值檢查（Dirty Check）
    const currentList = cachedGroupModels.get(targetGroupId) || [];
    const currentModelIds = currentList.map(m => m.model_id);
    const isSame = uniqueModelIds.length === currentModelIds.length &&
      uniqueModelIds.every((id, idx) => id === currentModelIds[idx]);

    if (isSame) {
      return { success: true, groupId: targetGroupId };
    }

    const db = getDb();
    const deleteStmt = db.prepare("DELETE FROM models_config WHERE group_id = ?");
    const insert = db.prepare("INSERT INTO models_config (group_id, model_id, priority, is_active) VALUES (?, ?, ?, 1)");

    try {
      db.exec("BEGIN TRANSACTION");
      deleteStmt.run(targetGroupId);
      uniqueModelIds.forEach((modelId, idx) => {
        insert.run(targetGroupId, modelId, idx + 1);
      });
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (_) {}
      throw err;
    }

    // 更新記憶體快取
    const newModels = uniqueModelIds.map((modelId, idx) => ({
      group_id: targetGroupId,
      model_id: modelId,
      priority: idx + 1,
      is_active: 1
    }));
    cachedGroupModels.set(targetGroupId, newModels);

    return { success: true, groupId: targetGroupId };
  },

  /**
   * 取得可用模型清單（100% 記憶體快取讀取，0 次 SQL 查詢）
   */
  getAvailable: () => {
    ensureCacheLoaded();
    return cachedAvailableModels.map(m => ({ ...m }));
  },

  getLastSyncTime: () => {
    ensureCacheLoaded();
    return cachedSyncMeta.lastTime;
  },

  getLastSyncSource: () => {
    ensureCacheLoaded();
    return cachedSyncMeta.lastSource;
  },

  getLastSyncExpectedCount: () => {
    ensureCacheLoaded();
    return cachedSyncMeta.expectedCount;
  },

  getLastSyncParsedCount: () => {
    ensureCacheLoaded();
    return cachedSyncMeta.parsedCount;
  },

  getLastSyncSavedCount: () => {
    ensureCacheLoaded();
    return cachedSyncMeta.savedCount;
  },

  /**
   * 從 NVIDIA 或自訂 Base URL 端點同步可用模型目錄
   */
  syncFromNvidia: async (keyValue = null) => {
    const db = getDb();
    const settings = require('./settings');
    const currentSettings = settings.get();
    const rawBaseUrl = currentSettings.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const targetBaseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
    const isCustomUrl = !targetBaseUrl.includes('integrate.api.nvidia.com') && !targetBaseUrl.includes('build.nvidia.com');

    try {
      let catalog = null;
      let lastErr = null;

      if (isCustomUrl) {
        // 自訂端點：直接從使用者配置的 Base URL /models 取得可用模型清單
        try {
          catalog = await fetchModelsFromEndpoint(targetBaseUrl, keyValue);
        } catch (err) {
          lastErr = err;
        }
      } else {
        // 預設 NVIDIA 端點：先嘗試爬取 Free Endpoint 目錄，若失敗則回退至官方 API /models
        try {
          catalog = await fetchNvidiaBuildFreeEndpointCatalog();
        } catch (err) {
          lastErr = err;
        }

        if (!catalog) {
          try {
            catalog = await fetchNvidiaIntegrateModelsCatalog(targetBaseUrl);
          } catch (err) {
            lastErr = err;
          }
        }

        if (!catalog) {
          try {
            catalog = await fetchNvidiaFeaturedModelsCatalog();
          } catch (err) {
            lastErr = err;
          }
        }

        if (!catalog) {
          try {
            catalog = await fetchModelsFromEndpoint(targetBaseUrl, keyValue);
          } catch (err) {
            lastErr = err;
          }
        }
      }

      if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
        return { success: false, error: lastErr ? lastErr.message : `無法從 ${targetBaseUrl}/models 取得有效模型列表` };
      }

      const parsedCount = catalog.models.length;

      try {
        db.exec("BEGIN TRANSACTION");
        db.exec("DELETE FROM available_models");
        const insert = db.prepare("INSERT OR REPLACE INTO available_models (id, name, created) VALUES (?, ?, ?)");

        const syncedModels = [];
        const seen = new Set();
        catalog.models.forEach((m) => {
          const modelId = typeof m.id === 'string' ? m.id.trim() : '';
          if (!modelId || seen.has(modelId)) return;
          seen.add(modelId);

          const modelName = typeof m.name === 'string' && m.name.trim()
            ? m.name.trim()
            : modelId.split('/').pop();
          const created = Number.isFinite(Number(m.created)) ? Number(m.created) : 0;

          insert.run(modelId, modelName, created);
          syncedModels.push(modelId);
        });

        const check = db.prepare("SELECT COUNT(*) as count FROM models_config WHERE group_id = 1").get();
        if (check.count === 0 && syncedModels.length > 0) {
          let activePresets = [];
          if (isCustomUrl) {
            activePresets = syncedModels.slice(0, 3);
          } else {
            const findPreferred = (patterns, exclude = []) => syncedModels.find(id => {
              const lowered = id.toLowerCase();
              return !exclude.includes(id) && patterns.some(pattern => lowered.includes(pattern));
            });
            const primary = findPreferred(['nemotron-3-ultra', 'deepseek-v4', 'kimi-k2', 'minimax-m3', 'llama-4', 'llama-3.3']) || syncedModels[0];
            const fallback1 = findPreferred(['qwen', 'glm', 'mistral', 'gemma', 'step'], [primary]) || syncedModels.find(id => id !== primary);
            const fallback2 = findPreferred(['minimax', 'deepseek', 'moonshotai', 'nvidia'], [primary, fallback1]) || syncedModels.find(id => id !== primary && id !== fallback1);
            activePresets = [primary, fallback1, fallback2].filter(Boolean);
          }
          const insertConfig = db.prepare("INSERT INTO models_config (group_id, model_id, priority, is_active) VALUES (1, ?, ?, 1)");
          activePresets.forEach((mId, index) => {
            insertConfig.run(mId, index + 1);
          });
        }
        const savedCount = syncedModels.length;
        const defaultSource = isCustomUrl ? `${targetBaseUrl}/models` : 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview';
        db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_time', ?)").run(getTaiwanISOString());
        db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_source', ?)").run(catalog.source || defaultSource);
        db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_expected_count', ?)").run(catalog.expectedCount ? String(catalog.expectedCount) : '');
        db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_parsed_count', ?)").run(String(parsedCount));
        db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_saved_count', ?)").run(String(savedCount));

        db.exec("COMMIT");

        // 刷新記憶體快取
        refreshCache();

        return {
          success: true,
          count: savedCount,
          parsedCount,
          savedCount,
          expectedCount: catalog.expectedCount,
          source: catalog.source || defaultSource
        };
      } catch (dbErr) {
        try { db.exec("ROLLBACK"); } catch (_) {}
        throw dbErr;
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = modelsConfig;

