const express = require('express');
const { stats, tokenUsage, settings } = require('../../database');
const eventManager = require('../sse/eventManager');
const { activeLogs, addLog } = require('../logs/logger');
const { requireAdminAuth, requireSseAuth } = require('../middleware/auth');
const { resolveModelGroupFromRequest, buildOpenAiModelsListForGroup } = require('../utils/modelGroup');
const { broadcastEvent } = require('../utils/broadcast');

const keyService = require('../services/KeyService');
const modelService = require('../services/ModelService');
const rulesService = require('../services/RulesService');
const settingsService = require('../services/SettingsService');
const healthService = require('../services/HealthService');
const packageInfo = require('../../package.json');

const router = express.Router();

// 0. 基礎狀態檢查與歡迎頁面 (防止連線測試出現 Cannot GET /v1 錯誤)
router.get('/', (req, res) => {
  res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: packageInfo.version });
});

router.get('/v1', (req, res) => {
  res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: packageInfo.version });
});

// 管理端點登入：驗證前端傳來的 token 是否匹配
router.post('/api/auth/login', requireAdminAuth, (req, res) => {
  res.json({ success: true });
});

// 定期廣播健康狀態 (Heartbeat) 到所有已連線的 SSE 用戶端
setInterval(async () => {
  try {
    if (eventManager.clients.size > 0) {
      const healthData = await healthService.getHealthStatus(false);
      broadcastEvent('health', healthData);
    }
  } catch (err) {
    // ignore
  }
}, 10000);

// SSE 即時事件推送端點
router.get('/api/events', requireSseAuth, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const healthData = await healthService.getHealthStatus(false);
  const initialPayload = `event: health\ndata: ${JSON.stringify(healthData)}\n\n`;
  res.write(initialPayload);

  activeLogs.forEach((log) => {
    res.write(`event: logs\ndata: ${JSON.stringify(log)}\n\n`);
  });

  eventManager.subscribe(res, req);
});

// 設定參數 APIs
router.get('/api/settings', requireAdminAuth, (req, res, next) => {
  try {
    const data = settingsService.getFormattedSettings();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/api/settings', requireAdminAuth, (req, res, next) => {
  try {
    const updated = settingsService.updateSettings(req.body, req.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Token 使用量統計 API
router.get('/api/token-usage', requireAdminAuth, (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

router.get('/api/token-usage/:id', requireAdminAuth, (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

router.post('/api/token-usage/clear', requireAdminAuth, (req, res, next) => {
  try {
    tokenUsage.clear();
    addLog('info', `已清空 Token 累加計數與使用量日誌。`, { requestId: req.id });
    broadcastEvent('token-usage', { action: 'clear' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// API Keys 管理
router.get('/api/keys', requireAdminAuth, (req, res, next) => {
  try {
    res.json(keyService.getMaskedKeys());
  } catch (err) {
    next(err);
  }
});

router.post('/api/keys', requireAdminAuth, (req, res, next) => {
  try {
    const result = keyService.addKey(req.body.key, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/api/keys/:id', requireAdminAuth, (req, res, next) => {
  try {
    const result = keyService.deleteKey(req.params.id, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/api/keys/test', requireAdminAuth, async (req, res, next) => {
  try {
    const results = await keyService.testAllKeys(req.id);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// 模型管理
router.get('/api/models', requireAdminAuth, (req, res, next) => {
  try {
    const groupId = req.query.groupId ? Number(req.query.groupId) : null;
    res.json(modelService.getModels(groupId));
  } catch (err) {
    next(err);
  }
});

router.post('/api/models', requireAdminAuth, (req, res, next) => {
  try {
    const { models, groupId } = req.body;
    const result = modelService.savePriorityList(models, groupId, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/api/models/groups', requireAdminAuth, (req, res, next) => {
  try {
    res.json(modelService.getGroups());
  } catch (err) {
    next(err);
  }
});

router.post('/api/models/groups/active', requireAdminAuth, (req, res, next) => {
  try {
    const result = modelService.setActiveGroup(req.body.groupId, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/api/models/available', requireAdminAuth, (req, res, next) => {
  try {
    res.json(modelService.getAvailable());
  } catch (err) {
    next(err);
  }
});

router.post('/api/models/sync', requireAdminAuth, async (req, res, next) => {
  try {
    const result = await modelService.syncFromNvidia(req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Rules 管理
router.get('/api/rules', requireAdminAuth, (req, res, next) => {
  try {
    res.json(rulesService.getAllRules());
  } catch (err) {
    next(err);
  }
});

router.post('/api/rules', requireAdminAuth, (req, res, next) => {
  try {
    const { title, content } = req.body;
    const result = rulesService.addRule(title, content, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.put('/api/rules/:id', requireAdminAuth, (req, res, next) => {
  try {
    const { title, content } = req.body;
    const result = rulesService.updateRule(req.params.id, title, content, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/api/rules/:id', requireAdminAuth, (req, res, next) => {
  try {
    const result = rulesService.deleteRule(req.params.id, req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 統計與狀態資訊
router.get('/api/stats', requireAdminAuth, (req, res, next) => {
  try {
    res.json({
      hourly: stats.getHourlyStats(),
      keysCount: keyService.getAllKeys().length,
      activeKeysCount: keyService.getActiveKeys().length,
      modelsCount: modelService.getModels().length
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/health', async (req, res, next) => {
  try {
    const detailed = req.query.deep === 'true' || req.query.detailed === 'true';
    const health = await healthService.getHealthStatus(detailed);
    const httpStatus = health.status === 'unhealthy' ? 503 : (health.status === 'degraded' ? 200 : 200);
    res.status(httpStatus).json(health);
  } catch (err) {
    next(err);
  }
});

// 重設模型冷卻狀態
router.post('/api/gateway/reset-cooldowns', requireAdminAuth, (req, res, next) => {
  try {
    const result = modelService.resetCooldowns(req.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// OpenAI 相容的 Models 列表端點
router.get('/v1/models', (req, res, next) => {
  try {
    const groupSelection = resolveModelGroupFromRequest(req);
    res.json(buildOpenAiModelsListForGroup(groupSelection.groupId));
  } catch (err) {
    next(err);
  }
});

router.get('/models', (req, res, next) => {
  try {
    const groupSelection = resolveModelGroupFromRequest(req);
    res.json(buildOpenAiModelsListForGroup(groupSelection.groupId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
