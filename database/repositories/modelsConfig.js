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
   * 從 NVIDIA 同步可用模型目錄
   */
  syncFromNvidia: async (keyValue = null) => {
    const db = getDb();
    try {
      let catalog;
      let lastErr = null;

      try {
        catalog = await fetchNvidiaBuildFreeEndpointCatalog();
      } catch (err) {
        lastErr = err;
      }

      if (!catalog) {
        try {
          catalog = await fetchNvidiaIntegrateModelsCatalog();
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

      if (!catalog && keyValue) {
        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${keyValue}`
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.data) && data.data.length > 0) {
              const seen = new Set();
              catalog = {
                models: data.data
                  .map((m) => {
                    const modelId = typeof m.id === 'string' ? m.id.trim() : '';
                    if (!modelId || seen.has(modelId)) return null;
                    seen.add(modelId);
                    return {
                      id: modelId,
                      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : modelId.split('/').pop(),
                      created: Number.isFinite(Number(m.created)) ? Number(m.created) : 0
                    };
                  })
                  .filter(Boolean),
                expectedCount: data.data.length,
                source: 'https://integrate.api.nvidia.com/v1/models'
              };
            }
          }
        } catch (err) {
          lastErr = err;
        }
      }

      if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
        return { success: false, error: lastErr ? lastErr.message : 'Invalid data format from NVIDIA models catalog' };
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
          const findPreferred = (patterns, exclude = []) => syncedModels.find(id => {
            const lowered = id.toLowerCase();
            return !exclude.includes(id) && patterns.some(pattern => lowered.includes(pattern));
          });
          const primary = findPreferred(['nemotron-3-ultra', 'deepseek-v4', 'kimi-k2', 'minimax-m3', 'llama-4', 'llama-3.3']) || syncedModels[0];
          const fallback1 = findPreferred(['qwen', 'glm', 'mistral', 'gemma', 'step'], [primary]) || syncedModels.find(id => id !== primary);
          const fallback2 = findPreferred(['minimax', 'deepseek', 'moonshotai', 'nvidia'], [primary, fallback1]) || syncedModels.find(id => id !== primary && id !== fallback1);

          const activePresets = [primary, fallback1, fallback2].filter(Boolean);
          const insertConfig = db.prepare("INSERT INTO models_config (group_id, model_id, priority, is_active) VALUES (1, ?, ?, 1)");
          activePresets.forEach((mId, index) => {
            insertConfig.run(mId, index + 1);
          });
        }
        const savedCount = syncedModels.length;
        const defaultSource = 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview';
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

