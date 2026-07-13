const { getDb } = require('../connection');
const { getTaiwanISOString } = require('../../utils/date');
const { fetchNvidiaBuildFreeEndpointCatalog } = require('../crawler/nvidiaBuildCrawler');
const { fetchNvidiaFeaturedModelsCatalog } = require('../crawler/nvidiaFeaturedCrawler');

function normalizeModelGroupId(groupId) {
  const parsed = Number.parseInt(groupId, 10);
  if ([1, 2, 3].includes(parsed)) return parsed;
  return 1;
}

const modelsConfig = {
  getActiveGroup: () => {
    try {
      const row = getDb().prepare("SELECT value FROM metadata WHERE key = 'active_model_group'").get();
      return normalizeModelGroupId(row ? row.value : 1);
    } catch (err) {
      return 1;
    }
  },
  setActiveGroup: (groupId) => {
    const normalizedGroupId = normalizeModelGroupId(groupId);
    getDb().prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('active_model_group', ?)").run(String(normalizedGroupId));
    return { success: true, activeGroup: normalizedGroupId };
  },
  getAll: (groupId = null) => {
    const targetGroupId = groupId === null ? modelsConfig.getActiveGroup() : normalizeModelGroupId(groupId);
    return getDb().prepare("SELECT * FROM models_config WHERE group_id = ? ORDER BY priority ASC").all(targetGroupId);
  },
  getGroups: () => {
    const activeGroup = modelsConfig.getActiveGroup();
    const groups = [1, 2, 3].map((groupId) => {
      const models = getDb().prepare("SELECT * FROM models_config WHERE group_id = ? ORDER BY priority ASC").all(groupId);
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
  savePriorityList: (modelIds, groupId = null) => {
    const targetGroupId = groupId === null ? modelsConfig.getActiveGroup() : normalizeModelGroupId(groupId);
    getDb().prepare("DELETE FROM models_config WHERE group_id = ?").run(targetGroupId);
    const insert = getDb().prepare("INSERT INTO models_config (group_id, model_id, priority, is_active) VALUES (?, ?, ?, 1)");
    const uniqueModelIds = [...new Set(modelIds.filter(Boolean))];
    uniqueModelIds.forEach((modelId, idx) => {
      insert.run(targetGroupId, modelId, idx + 1);
    });
    return { success: true, groupId: targetGroupId };
  },
  getAvailable: () => {
    return getDb().prepare("SELECT * FROM available_models ORDER BY id ASC").all();
  },
  getLastSyncTime: () => {
    try {
      const row = getDb().prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_time'").get();
      return row ? row.value : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncSource: () => {
    try {
      const row = getDb().prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_source'").get();
      return row ? row.value : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncExpectedCount: () => {
    try {
      const row = getDb().prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_expected_count'").get();
      const count = row && row.value ? Number(row.value) : null;
      return Number.isFinite(count) && count > 0 ? count : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncParsedCount: () => {
    try {
      const row = getDb().prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_parsed_count'").get();
      const count = row && row.value ? Number(row.value) : null;
      return Number.isFinite(count) && count >= 0 ? count : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncSavedCount: () => {
    try {
      const row = getDb().prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_saved_count'").get();
      const count = row && row.value ? Number(row.value) : null;
      return Number.isFinite(count) && count >= 0 ? count : null;
    } catch (err) {
      return null;
    }
  },
  syncFromNvidia: async (keyValue = null) => {
    const db = getDb();
    try {
      let catalog;
      try {
        catalog = await fetchNvidiaBuildFreeEndpointCatalog();
      } catch (buildErr) {
        let fallbackError = buildErr;
        try {
          catalog = await fetchNvidiaFeaturedModelsCatalog();
        } catch (featuredErr) {
          fallbackError = featuredErr;
        }

        if (!catalog && keyValue) {
          const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${keyValue}`
            }
          });
          if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            throw new Error(`NVIDIA Build catalog failed (${buildErr.message}); fallback /v1/models replied with HTTP ${res.status}${errorText ? `: ${errorText.substring(0, 200)}` : ''}`);
          }
          const data = await res.json();
          if (!data || !Array.isArray(data.data)) {
            throw new Error(`NVIDIA Build catalog failed (${buildErr.message}); fallback /v1/models returned invalid data.`);
          }
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
            expectedCount: null,
            source: 'https://integrate.api.nvidia.com/v1/models'
          };
        }

        if (!catalog) throw fallbackError;
      }

      if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
        return { success: false, error: 'Invalid data format from NVIDIA Build catalog' };
      }

      const parsedCount = catalog.models.length;

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

      return {
        success: true,
        count: savedCount,
        parsedCount,
        savedCount,
        expectedCount: catalog.expectedCount,
        source: catalog.source || defaultSource
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = modelsConfig;
