/**
 * /v1/chat/completions 與 /api/test/chat 路由
 *
 * 本檔案僅負責：
 *  1. Express Router 註冊
 *  2. 請求前處理：解析 requestId/stream、客戶端連線監聽、解析模型組
 *  3. 啟動假串流（若為 stream 模式）
 *  4. 委派給 gateway/chat/ 下的拆分模組：
 *      - context/chatContext.js    → createChatContext 工廠
 *      - response/fakeStream.js    → 假串流控制器
 *      - dispatch/dispatchRequest.js → 主調度迴圈
 *      - testChat.js               → 模型測試路由 handler
 */

const express = require('express');
const { modelsConfig, settings } = require('../../database');
const { resolveModelGroupFromRequest } = require('../utils/modelGroup');
const { sanitizeChatCompletionBody } = require('../utils/sanitize');
const { requireAdminAuth } = require('../middleware/auth');
const { createChatContext, resolveRetryLimits } = require('../chat/context/chatContext');
const { createFakeStreamController } = require('../chat/response/fakeStream');
const { dispatchRequest, handleDispatchError } = require('../chat/dispatch/dispatchRequest');
const { handleTestChat } = require('../chat/testChat');

const router = express.Router();

router.post('/v1/chat/completions', async (req, res) => {
  const originalBody = req.body;
  const activeConfig = settings.get();
  const { MAX_ROUNDS_PER_MODEL, MAX_EMPTY_RESPONSE_RETRIES } = resolveRetryLimits(activeConfig);

  const context = createChatContext({ req, res, originalBody, activeConfig });
  context.MAX_ROUNDS_PER_MODEL = MAX_ROUNDS_PER_MODEL;
  context.MAX_EMPTY_RESPONSE_RETRIES = MAX_EMPTY_RESPONSE_RETRIES;

  const { requestId, stream, isClientGone } = context;

  const groupSelection = resolveModelGroupFromRequest(req);
  const configuredModels = modelsConfig.getAll(groupSelection.groupId).filter(m => m.is_active === 1);
  if (configuredModels.length === 0) {
    const detail = groupSelection.fromClientKey
      ? `客戶端指定第 ${groupSelection.groupId} 組，但該組沒有任何啟用中的模型順位。`
      : `目前啟用的第 ${groupSelection.groupId} 組沒有任何啟用中的模型順位。`;
    context.addLog('error', `請求 #${requestId} 已拒絕：${detail}`);
    return res.status(500).json({
      error: {
        message: 'No active models configured in the selected Gateway model group',
        detail,
        modelGroup: groupSelection.groupId,
        type: 'invalid_request_error',
        code: 'no_active_models'
      }
    });
  }

  const groupSourceText = groupSelection.fromClientKey
    ? `由客戶端 API Key/Header 指定第 ${groupSelection.groupId} 組`
    : `使用目前啟用的第 ${groupSelection.groupId} 組`;
  context.addLog('info', `請求 #${requestId} 已收到（stream=${stream}），${groupSourceText}模型順位，開始調度。`);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    context.fakeStreamController = createFakeStreamController({
      res,
      originalBody,
      requestId,
      isClientGone
    });
    context.fakeStreamController.start();
  }

  const sanitizedBody = sanitizeChatCompletionBody(originalBody);

  try {
    await dispatchRequest({ context, configuredModels, sanitizedBody });
  } catch (err) {
    await handleDispatchError({ context, err, stream });
  }
});

router.post('/api/test/chat', requireAdminAuth, async (req, res) => {
  await handleTestChat(req, res);
});

module.exports = router;