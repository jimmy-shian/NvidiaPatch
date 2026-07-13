const express = require('express');
const { apiKeys, modelsConfig, stats, rules, settings, tokenUsage } = require('../../database');
const eventManager = require('../sse/eventManager');
const { addLog, activeLogs } = require('../logs/logger');
const { clearAllModelCooldowns } = require('../cooldown/modelCooldown');
const { requireAdminAuth, requireSseAuth } = require('../middleware/auth');
const { resolveModelGroupFromRequest, buildOpenAiModelsListForGroup } = require('../utils/modelGroup');
const { maskKeyRow } = require('../utils/keyMasking');
const { getTaiwanISOString } = require('../../utils/date');

const router = express.Router();

// 0. 基礎狀態檢查與歡迎頁面 (防止連線測試出現 Cannot GET /v1 錯誤)
router.get('/', (req, res) => {
  res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: "1.0.1" });
});

router.get('/v1', (req, res) => {
  res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: "1.0.1" });
});

// 管理端點登入：驗證前端傳來的 token 是否匹配
router.post('/api/auth/login', requireAdminAuth, (req, res) => {
  res.json({ success: true });
});

const getHealthData = () => {
  const activeKeys = apiKeys.getActiveKeys();
  const allKeys = apiKeys.getAll();
  const activeModels = modelsConfig.getAll().filter(m => m.is_active === 1);
  return {
    status: 'running',
    uptime: process.uptime(),
    timestamp: getTaiwanISOString(),
    keys: { total: allKeys.length, active: activeKeys.length },
    models: { active: activeModels.length }
  };
};

// 定期廣播健康狀態 (Heartbeat) 到所有已連線的 SSE 用戶端，避免前端判定斷線
setInterval(() => {
  try {
    if (eventManager.clients.size > 0) {
      eventManager.broadcast('health', getHealthData());
    }
  } catch (err) {
    console.error('[SSE] Failed to broadcast health:', err);
  }
}, 10000);

// SSE 即時事件推送端點
router.get('/api/events', requireSseAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const initialPayload = `event: health\ndata: ${JSON.stringify(getHealthData())}\n\n`;
  res.write(initialPayload);

  activeLogs.forEach((log) => {
    res.write(`event: logs\ndata: ${JSON.stringify(log)}\n\n`);
  });

  eventManager.subscribe(res);
});

// 設定參數 APIs
router.get('/api/settings', requireAdminAuth, (req, res) => {
  const current = settings.get();
  res.json({
    ...current,
    ROUND_DELAY_MS: current.ROUND_DELAY_MS / 1000,
    REQUEST_TIMEOUT_MS: current.REQUEST_TIMEOUT_MS / 1000,
    STREAM_READ_TIMEOUT_MS: current.STREAM_READ_TIMEOUT_MS / 1000,
    TEST_TIMEOUT_MS: current.TEST_TIMEOUT_MS / 1000,
    MODEL_FAILURE_COOLDOWN_MS: current.MODEL_FAILURE_COOLDOWN_MS / 1000,
    KEY_CONCURRENCY_DELAY_MS: current.KEY_CONCURRENCY_DELAY_MS / 1000
  });
});

router.post('/api/settings', requireAdminAuth, (req, res) => {
  const { ROUND_DELAY_MS, REQUEST_TIMEOUT_MS, STREAM_READ_TIMEOUT_MS, NVIDIA_API_URL, PORT, MAX_ROUNDS_PER_MODEL, TEST_TIMEOUT_MS, MODEL_FAILURE_COOLDOWN_MS, KEY_CONCURRENCY_DELAY_MS, PRICE_PER_MILLION_PROMPT_TOKENS, PRICE_PER_MILLION_COMPLETION_TOKENS, REF_PRICE_PER_MILLION_PROMPT_TOKENS, REF_PRICE_PER_MILLION_COMPLETION_TOKENS, CURRENCY_SYMBOL } = req.body;
  const current = settings.get();

  const validationErrors = [];
  if (PORT !== undefined) {
    const portNum = Number(PORT);
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535 || !Number.isInteger(portNum)) {
      validationErrors.push('PORT 必須是 1～65535 之間的整數。');
    }
  }
  if (ROUND_DELAY_MS !== undefined) {
    const val = Number(ROUND_DELAY_MS);
    if (!Number.isFinite(val) || val < 1) {
      validationErrors.push('每輪重試等待時間必須至少 1 秒。');
    }
  }
  if (REQUEST_TIMEOUT_MS !== undefined) {
    const val = Number(REQUEST_TIMEOUT_MS);
    if (!Number.isFinite(val) || val < 1) {
      validationErrors.push('請求逾時必須至少 1 秒。');
    }
  }
  if (STREAM_READ_TIMEOUT_MS !== undefined) {
    const val = Number(STREAM_READ_TIMEOUT_MS);
    if (!Number.isFinite(val) || val < 1) {
      validationErrors.push('串流讀取逾時必須至少 1 秒。');
    }
  }
  if (TEST_TIMEOUT_MS !== undefined) {
    const val = Number(TEST_TIMEOUT_MS);
    if (!Number.isFinite(val) || val < 1) {
      validationErrors.push('測試逾時必須至少 1 秒。');
    }
  }
  if (MODEL_FAILURE_COOLDOWN_MS !== undefined) {
    const val = Number(MODEL_FAILURE_COOLDOWN_MS);
    if (!Number.isFinite(val) || val < 0) {
      validationErrors.push('模型冷卻時間不可小於 0 秒。');
    }
  }
  if (KEY_CONCURRENCY_DELAY_MS !== undefined) {
    const val = Number(KEY_CONCURRENCY_DELAY_MS);
    if (!Number.isFinite(val) || val < 0) {
      validationErrors.push('金鑰防併發等待時間不可小於 0 秒。');
    }
  }
  if (MAX_ROUNDS_PER_MODEL !== undefined) {
    const val = Number(MAX_ROUNDS_PER_MODEL);
    if (!Number.isFinite(val) || val < 1 || val > 10 || !Number.isInteger(val)) {
      validationErrors.push('最大重試輪數必須是 1～10 之間的整數。');
    }
  }
  if (PRICE_PER_MILLION_PROMPT_TOKENS !== undefined && Number(PRICE_PER_MILLION_PROMPT_TOKENS) < 0) {
    validationErrors.push('Prompt 實際價格不可小於 0。');
  }
  if (PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined && Number(PRICE_PER_MILLION_COMPLETION_TOKENS) < 0) {
    validationErrors.push('Completion 實際價格不可小於 0。');
  }
  if (REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined && Number(REF_PRICE_PER_MILLION_PROMPT_TOKENS) < 0) {
    validationErrors.push('Prompt 參考價格不可小於 0。');
  }
  if (REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined && Number(REF_PRICE_PER_MILLION_COMPLETION_TOKENS) < 0) {
    validationErrors.push('Completion 參考價格不可小於 0。');
  }
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: '設定驗證失敗', details: validationErrors });
  }
  
  const updated = settings.save({
    ROUND_DELAY_MS: ROUND_DELAY_MS !== undefined ? Math.round(Number(ROUND_DELAY_MS) * 1000) : current.ROUND_DELAY_MS,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS !== undefined ? Math.round(Number(REQUEST_TIMEOUT_MS) * 1000) : current.REQUEST_TIMEOUT_MS,
    STREAM_READ_TIMEOUT_MS: STREAM_READ_TIMEOUT_MS !== undefined ? Math.round(Number(STREAM_READ_TIMEOUT_MS) * 1000) : current.STREAM_READ_TIMEOUT_MS,
    NVIDIA_API_URL: NVIDIA_API_URL !== undefined ? String(NVIDIA_API_URL).trim() : current.NVIDIA_API_URL,
    PORT: PORT !== undefined ? Number(PORT) : current.PORT,
    MAX_ROUNDS_PER_MODEL: MAX_ROUNDS_PER_MODEL !== undefined ? Number(MAX_ROUNDS_PER_MODEL) : current.MAX_ROUNDS_PER_MODEL,
    TEST_TIMEOUT_MS: TEST_TIMEOUT_MS !== undefined ? Math.round(Number(TEST_TIMEOUT_MS) * 1000) : current.TEST_TIMEOUT_MS,
    MODEL_FAILURE_COOLDOWN_MS: MODEL_FAILURE_COOLDOWN_MS !== undefined ? Math.round(Number(MODEL_FAILURE_COOLDOWN_MS) * 1000) : current.MODEL_FAILURE_COOLDOWN_MS,
    KEY_CONCURRENCY_DELAY_MS: KEY_CONCURRENCY_DELAY_MS !== undefined ? Math.round(Number(KEY_CONCURRENCY_DELAY_MS) * 1000) : current.KEY_CONCURRENCY_DELAY_MS,
    PRICE_PER_MILLION_PROMPT_TOKENS: PRICE_PER_MILLION_PROMPT_TOKENS !== undefined ? Number(PRICE_PER_MILLION_PROMPT_TOKENS) : current.PRICE_PER_MILLION_PROMPT_TOKENS,
    PRICE_PER_MILLION_COMPLETION_TOKENS: PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined ? Number(PRICE_PER_MILLION_COMPLETION_TOKENS) : current.PRICE_PER_MILLION_COMPLETION_TOKENS,
    REF_PRICE_PER_MILLION_PROMPT_TOKENS: REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined ? Number(REF_PRICE_PER_MILLION_PROMPT_TOKENS) : current.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
    REF_PRICE_PER_MILLION_COMPLETION_TOKENS: REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined ? Number(REF_PRICE_PER_MILLION_COMPLETION_TOKENS) : current.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
    CURRENCY_SYMBOL: CURRENCY_SYMBOL !== undefined ? String(CURRENCY_SYMBOL).trim() : current.CURRENCY_SYMBOL
  });
  
  addLog('info', `已更新參數設定：每輪等待 ${(updated.ROUND_DELAY_MS / 1000)}秒, 請求逾時 ${(updated.REQUEST_TIMEOUT_MS / 1000)}秒, 串流逾時 ${(updated.STREAM_READ_TIMEOUT_MS / 1000)}秒, 測試逾時 ${(updated.TEST_TIMEOUT_MS / 1000)}秒, 模型失敗冷卻 ${(updated.MODEL_FAILURE_COOLDOWN_MS / 1000)}秒, 金鑰防併發等待 ${(updated.KEY_CONCURRENCY_DELAY_MS / 1000)}秒, URL: ${updated.NVIDIA_API_URL}, PORT: ${updated.PORT}, 最大重試: ${updated.MAX_ROUNDS_PER_MODEL}輪`);

  eventManager.broadcast('settings', {
    ...updated,
    ROUND_DELAY_MS: updated.ROUND_DELAY_MS / 1000,
    REQUEST_TIMEOUT_MS: updated.REQUEST_TIMEOUT_MS / 1000,
    STREAM_READ_TIMEOUT_MS: updated.STREAM_READ_TIMEOUT_MS / 1000,
    TEST_TIMEOUT_MS: updated.TEST_TIMEOUT_MS / 1000,
    MODEL_FAILURE_COOLDOWN_MS: updated.MODEL_FAILURE_COOLDOWN_MS / 1000,
    KEY_CONCURRENCY_DELAY_MS: updated.KEY_CONCURRENCY_DELAY_MS / 1000
  });
  
  res.json({
    ...updated,
    ROUND_DELAY_MS: updated.ROUND_DELAY_MS / 1000,
    REQUEST_TIMEOUT_MS: updated.REQUEST_TIMEOUT_MS / 1000,
    STREAM_READ_TIMEOUT_MS: updated.STREAM_READ_TIMEOUT_MS / 1000,
    TEST_TIMEOUT_MS: updated.TEST_TIMEOUT_MS / 1000
  });
});

// Token 使用量統計 API
router.get('/api/token-usage', requireAdminAuth, (req, res) => {
  const currentSettings = settings.get();
  res.json({
    stats: tokenUsage.getStats(),
    logs: tokenUsage.getLogs(100),
    pricing: {
      pricePerMillionPromptTokens: currentSettings.PRICE_PER_MILLION_PROMPT_TOKENS,
      pricePerMillionCompletionTokens: currentSettings.PRICE_PER_MILLION_COMPLETION_TOKENS,
      refPricePerMillionPromptTokens: currentSettings.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
      refPricePerMillionCompletionTokens: currentSettings.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
      currencySymbol: currentSettings.CURRENCY_SYMBOL
    }
  });
});

router.get('/api/token-usage/:id', requireAdminAuth, (req, res) => {
  const record = tokenUsage.getDetail(Number(req.params.id));
  if (!record) return res.status(404).json({ error: 'Record not found' });
  const currentSettings = settings.get();
  res.json({
    ...record,
    pricing: {
      pricePerMillionPromptTokens: currentSettings.PRICE_PER_MILLION_PROMPT_TOKENS,
      pricePerMillionCompletionTokens: currentSettings.PRICE_PER_MILLION_COMPLETION_TOKENS,
      refPricePerMillionPromptTokens: currentSettings.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
      refPricePerMillionCompletionTokens: currentSettings.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
      currencySymbol: currentSettings.CURRENCY_SYMBOL
    }
  });
});

router.post('/api/token-usage/clear', requireAdminAuth, (req, res) => {
  tokenUsage.clear();
  addLog('info', `已清空 Token 累加計數與使用量日誌。`);
  eventManager.broadcast('token-usage', { action: 'clear' });
  res.json({ success: true });
});

// API Keys 管理
router.get('/api/keys', requireAdminAuth, (req, res) => {
  const allKeys = apiKeys.getAll();
  res.json(allKeys.map(maskKeyRow));
});

router.post('/api/keys', requireAdminAuth, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });
  const result = apiKeys.add(key.trim());
  if (result.success) {
    addLog('info', `已新增 API Key：${key.substring(0, 10)}...`);
    eventManager.broadcast('keys', { action: 'add' });
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

router.delete('/api/keys/:id', requireAdminAuth, (req, res) => {
  apiKeys.delete(req.params.id);
  addLog('info', `已刪除 API Key ID：${req.params.id}`);
  eventManager.broadcast('keys', { action: 'delete', id: req.params.id });
  res.json({ success: true });
});

router.post('/api/keys/test', requireAdminAuth, async (req, res) => {
  addLog('info', '開始手動測試所有 API Key 連線狀態。');
  const results = await apiKeys.testAllKeys();
  const successCount = results.filter(r => r.success).length;
  addLog('info', `API Key 測試完成：${successCount}/${results.length} 把 Key 可用。`);
  eventManager.broadcast('keys', { action: 'test', results: results.map(r => ({ id: r.id, status: r.status, success: r.success })) });
  res.json(results);
});

// 模型管理
router.get('/api/models', requireAdminAuth, (req, res) => {
  const groupId = req.query.groupId ? Number(req.query.groupId) : null;
  res.json(modelsConfig.getAll(groupId));
});

router.post('/api/models', requireAdminAuth, (req, res) => {
  const { models, groupId } = req.body;
  if (!models || !Array.isArray(models)) {
    return res.status(400).json({ error: 'Models list is required' });
  }
  const result = modelsConfig.savePriorityList(models, groupId);
  addLog('info', `已更新第 ${result.groupId} 組模型順位：${models.join(' -> ')}`);
  res.json({ success: true, groupId: result.groupId });
});

router.get('/api/models/groups', requireAdminAuth, (req, res) => {
  res.json(modelsConfig.getGroups());
});

router.post('/api/models/groups/active', requireAdminAuth, (req, res) => {
  const { groupId } = req.body;
  const result = modelsConfig.setActiveGroup(groupId);
  addLog('info', `已切換目前使用的模型順位組別為第 ${result.activeGroup} 組。`);
  eventManager.broadcast('models', { action: 'set-active-group', activeGroup: result.activeGroup });
  res.json(result);
});

router.get('/api/models/available', requireAdminAuth, (req, res) => {
  res.json({
    models: modelsConfig.getAvailable(),
    lastSyncTime: modelsConfig.getLastSyncTime(),
    lastSyncSource: modelsConfig.getLastSyncSource(),
    expectedCount: modelsConfig.getLastSyncExpectedCount(),
    parsedCount: modelsConfig.getLastSyncParsedCount(),
    savedCount: modelsConfig.getLastSyncSavedCount()
  });
});

router.post('/api/models/sync', requireAdminAuth, async (req, res) => {
  const activeKeys = apiKeys.getActiveKeys();
  const fallbackKey = activeKeys.length > 0 ? activeKeys[0].key_value : null;

  addLog('info', '開始從 NVIDIA Build 目錄同步 Free Endpoint 模型清單。');
  const result = await modelsConfig.syncFromNvidia(fallbackKey);
  if (result.success) {
    const expectedText = result.expectedCount ? ` / NVIDIA Build 標示 ${result.expectedCount} 個` : '';
    addLog('success', `Free Endpoint 模型清單同步完成：解析 ${result.parsedCount} 個，入庫 ${result.savedCount} 個${expectedText}。來源：${result.source || 'NVIDIA Build 目錄'}`);
    res.json({
      success: true,
      count: result.savedCount,
      parsedCount: result.parsedCount,
      savedCount: result.savedCount,
      expectedCount: result.expectedCount || null,
      source: result.source || null
    });
  } else {
    addLog('error', `同步模型失敗：${result.error}`);
    res.status(500).json({ error: result.error });
  }
});

// Rules 管理
router.get('/api/rules', requireAdminAuth, (req, res) => {
  res.json(rules.getAll());
});

router.post('/api/rules', requireAdminAuth, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and Content are required' });
  const result = rules.add(title, content);
  if (result.success) {
    addLog('info', `已新增自訂規範：「${title}」`);
    eventManager.broadcast('rules', { action: 'add' });
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

router.put('/api/rules/:id', requireAdminAuth, (req, res) => {
  const { title, content } = req.body;
  const result = rules.update(req.params.id, title, content);
  if (result.success) {
    addLog('info', `已更新自訂規範 ID：${req.params.id}`);
    eventManager.broadcast('rules', { action: 'update', id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

router.delete('/api/rules/:id', requireAdminAuth, (req, res) => {
  const result = rules.delete(req.params.id);
  if (result.success) {
    addLog('info', `已刪除自訂規範 ID：${req.params.id}`);
    eventManager.broadcast('rules', { action: 'delete', id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// 統計與狀態資訊
router.get('/api/stats', requireAdminAuth, (req, res) => {
  res.json({
    hourly: stats.getHourlyStats(),
    keysCount: apiKeys.getAll().length,
    activeKeysCount: apiKeys.getActiveKeys().length,
    modelsCount: modelsConfig.getAll().length
  });
});

router.get('/api/health', (req, res) => {
  const activeKeys = apiKeys.getActiveKeys();
  const allKeys = apiKeys.getAll();
  const activeModels = modelsConfig.getAll().filter(m => m.is_active === 1);
  res.json({
    status: 'running',
    uptime: process.uptime(),
    timestamp: getTaiwanISOString(),
    keys: { total: allKeys.length, active: activeKeys.length },
    models: { active: activeModels.length },
    memoryUsage: process.memoryUsage()
  });
});

// 重設模型冷卻狀態
router.post('/api/gateway/reset-cooldowns', requireAdminAuth, (req, res) => {
  const cleared = clearAllModelCooldowns();
  if (cleared > 0) {
    addLog('info', `已手動清除 ${cleared} 個模型的暫時跳過冷卻狀態。`);
  }
  res.json({ success: true, clearedCooldowns: cleared });
});

// OpenAI 相容的 Models 列表端點
router.get('/v1/models', (req, res) => {
  const groupSelection = resolveModelGroupFromRequest(req);
  res.json(buildOpenAiModelsListForGroup(groupSelection.groupId));
});

router.get('/models', (req, res) => {
  const groupSelection = resolveModelGroupFromRequest(req);
  res.json(buildOpenAiModelsListForGroup(groupSelection.groupId));
});

module.exports = router;
