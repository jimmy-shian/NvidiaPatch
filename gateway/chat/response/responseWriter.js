/**
 * 回傳寫入工具（Response Writer）
 *
 * 封裝所有對 res 的寫入操作：
 *  - waitForResponseFinish：等待 res 完成（含 finish / close / error）
 *  - sendValidatedResponse：寫入校驗後的回應（串流 / JSON 分支）
 *  - sendStreamError：在串流 header 已送出時，以 SSE chunk 回報錯誤並以 [DONE] 收尾
 *
 * sendValidatedResponse 完成後會：
 *  - 記錄成功請求 stats
 *  - 將 token usage 寫入資料庫 + 廣播 SSE
 *  - 停止假串流
 */

const { stats, tokenUsage } = require('../../../database');
const eventManager = require('../../sse/eventManager');
const { addLog } = require('../../logs/logger');
const { buildSafeSsePayload } = require('./ssePayloadBuilder');

/**
 * 等待 res 的 finish / close / error；若 sendAction 內同步拋錯則 reject。
 */
function waitForResponseFinish(res, sendAction) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      res.off('finish', onFinish);
      res.off('close', onClose);
      res.off('error', onError);
    };

    const onFinish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('客戶端在回傳完成前中斷連線'));
    };

    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    res.once('finish', onFinish);
    res.once('close', onClose);
    res.once('error', onError);

    try {
      sendAction();
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }
  });
}

/**
 * 在串流 header 已送出的情況下回報錯誤並以 [DONE] 收尾。
 * 會主動停掉假串流計時器。
 */
function sendStreamError({ context, errorPayload }) {
  const { requestId, originalBody, res, fakeStreamController } = context;

  if (fakeStreamController) fakeStreamController.stop();
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  }
  try {
    res.write(`data: ${JSON.stringify({
      id: `chatcmpl-gateway-${requestId}-error`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: originalBody.model || 'patcher-main',
      choices: [{
        index: 0,
        delta: { content: `\n\n[Gateway Error] ${errorPayload.message || ''}${errorPayload.detail ? ` (${errorPayload.detail})` : ''}` },
        finish_reason: 'stop'
      }]
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    // ignore
  }
}

/**
 * 將校驗後的結果送回客戶端，並寫入 token 用量統計與 SSE 廣播。
 */
async function sendValidatedResponse({ context, result, currentModel }) {
  const { requestId, requestStartedAt, stream, originalBody, res, fakeStreamController } = context;
  const modelId = currentModel.model_id;
  const clientModelId = originalBody.model || 'patcher-main';

  if (context.isClientGone()) {
    throw new Error('客戶端已中斷連線，略過回傳。');
  }

  if (result.passthrough && stream) {
    return sendPassthroughResponse({ context, result, currentModel });
  }

  if (stream) {
    const ssePayload = buildSafeSsePayload({
      requestId,
      sseLines: result.sseLines,
      clientModelId
    });
    if (!ssePayload || !ssePayload.includes('data:') || !ssePayload.includes('[DONE]')) {
      throw new Error('校驗後的串流內容是空的或格式不正確。');
    }

    await waitForResponseFinish(res, () => {
      if (fakeStreamController) fakeStreamController.stop();
      res.write(ssePayload);
      res.end();
    });
   } else {
    const json = result.jsonData;
    if (json && typeof json === 'object') {
      json.model = clientModelId;
      // 非串流模式：清理回應內容中的假串流字元，避免客戶端存入對話歷史。
      const stripFake = (c) => {
        if (typeof c === 'string') return c.replace(/\uE000+/g, '');
        return c;
      };
      const target = json?.choices?.[0]?.message;
      if (target) {
        if (typeof target.content === 'string') target.content = stripFake(target.content);
        if (typeof target.reasoning_content === 'string') target.reasoning_content = stripFake(target.reasoning_content);
      }
    }

    await waitForResponseFinish(res, () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json(json);
    });
  }

  stats.recordRequest(true);
  const durationMs = Date.now() - requestStartedAt;

  try {
    const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let responseContent = '';
    if (stream) {
      responseContent = result.streamContent || '';
    } else {
      responseContent = result.jsonData?.choices?.[0]?.message?.content || '';
    }

    const bodyToRecord = context.sanitizedBody || originalBody;
    tokenUsage.addRecord(requestId, modelId, usage.prompt_tokens, usage.completion_tokens, bodyToRecord.messages, responseContent);
    eventManager.broadcast('token-usage', { action: 'add', modelId, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
    addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。[Tokens: P:${usage.prompt_tokens} + C:${usage.completion_tokens} = T:${usage.prompt_tokens + usage.completion_tokens}]`);
  } catch (tokenErr) {
    console.error('Failed to record token usage:', tokenErr);
    addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。`);
  }
}

/**
 * 即時透傳上游串流回客戶端（僅在 ENABLE_CONTENT_VALIDATION === false 時使用）。
 *
 * 流程：
 *  - 寫 SSE header
 *  - 逐 chunk 將原始位元組寫到 res，不重新組裝
 *  - end() 後計算耗時、寫 token usage、廣播 SSE
 *  - 客戶端中斷 / 寫入失敗拋出，由 dispatchRequest 處理
 */
async function sendPassthroughResponse({ context, result, currentModel }) {
  const { requestId, requestStartedAt, originalBody, res, fakeStreamController } = context;
  const modelId = currentModel.model_id;
  const clientModelId = originalBody.model || 'patcher-main';

  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  }

  await waitForResponseFinish(res, () => {
    if (fakeStreamController) fakeStreamController.stop();
    const rawChunks = Array.isArray(result.rawChunks) ? result.rawChunks : [];
    for (const chunk of rawChunks) {
      if (chunk && chunk.length) res.write(Buffer.from(chunk));
    }
    res.end();
  });

  stats.recordRequest(true);
  const durationMs = Date.now() - requestStartedAt;

  try {
    const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const bodyToRecord = context.sanitizedBody || originalBody;
    tokenUsage.addRecord(requestId, modelId, usage.prompt_tokens, usage.completion_tokens, bodyToRecord.messages, '');
    eventManager.broadcast('token-usage', { action: 'add', modelId, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
    addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）以即時透傳完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。[Tokens: P:${usage.prompt_tokens} + C:${usage.completion_tokens} = T:${usage.prompt_tokens + usage.completion_tokens}]`);
  } catch (tokenErr) {
    console.error('Failed to record token usage:', tokenErr);
    addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）以即時透傳完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。`);
  }
}

module.exports = {
  waitForResponseFinish,
  sendValidatedResponse,
  sendPassthroughResponse,
  sendStreamError
};