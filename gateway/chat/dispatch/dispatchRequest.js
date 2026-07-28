/**
 * 主調度迴圈（Dispatch Request）
 *
 * 依 configuredModels 順序逐一嘗試每個模型（已過濾 is_active=1）：
 *
 *  - 對每個模型做最多 MAX_ROUNDS_PER_MODEL 輪嘗試
 *  - 第 1 輪不等待；後續輪依 lastResult 決定等待時間
 *  - 成功 → 送回客戶端後 return
 *  - noHealthyKeys → 視情形 stream error 或 503
 *  - fatal → 視情形 stream error 或 400
 *  - forceFallbackModel → 標記模型冷卻、跳到下一個模型
 *  - forceRetrySameModel → 繼續下一輪
 *  - 包裝回傳失敗 → 視 headerSent 決定用 SSE error 或 end()
 *
 * 所有模型皆失敗時，最終發出 stream error 或 503。
 */

const { stats } = require('../../../database');
const { isModelInFailureCooldown, markModelFailureCooldown } = require('../../cooldown/modelCooldown');
const { addLog } = require('../../logs/logger');
const { tryModelWithKeys } = require('./modelRound');
const { sendValidatedResponse, sendStreamError } = require('../response/responseWriter');

async function handleDispatchError({ context, err, stream }) {
  const { requestId, res } = context;
  addLog('error', `請求 #${requestId}：Gateway 調度流程發生未預期錯誤：${err.stack || err.message}`);
  stats.recordRequest(false);

  if (stream && res.headersSent) {
    return sendStreamError({
      context,
      errorPayload: {
        message: 'Gateway dispatch crashed before a response could be sent.',
        detail: err.message
      }
    });
  }

  if (!res.headersSent && !res.writableEnded) {
    return res.status(502).json({
      error: {
        message: 'Gateway dispatch crashed before a response could be sent. Check Gateway logs.',
        detail: err.message,
        type: 'api_error',
        code: 'dispatch_crashed'
      }
    });
  }

  try {
    res.end();
  } catch (endErr) {
    // ignore
  }
}

async function handleSuccessfulResult({ context, result, currentModel }) {
  const { requestId, stream, res, isClientGone } = context;
  const modelId = currentModel.model_id;
  try {
    await sendValidatedResponse({ context, result, currentModel });
  } catch (err) {
    addLog('error', `請求 #${requestId}：模型「${modelId}」在 Gateway 包裝回傳時失敗（${err.message}），改切下一個模型。`);
    if (!res.headersSent && !res.writableEnded) {
      markModelFailureCooldown(modelId, `Gateway 回傳包裝失敗：${err.message}`);
      return { abortModel: true };
    }
    if (stream && res.headersSent) {
      if (context.fakeStreamController) context.fakeStreamController.stop();
      try {
        res.write(`data: ${JSON.stringify({
          id: `chatcmpl-gateway-${requestId}-error`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: context.originalBody.model || 'patcher-main',
          choices: [{
            index: 0,
            delta: { content: `\n\n[Gateway Error] 包裝回傳失敗：${err.message}` },
            finish_reason: 'stop'
          }]
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (endErr) {
        // ignore
      }
    } else {
      try {
        res.end();
      } catch (endErr) {
        // ignore
      }
    }
    return { abortRequest: true };
  }
  return {};
}

function handleRoundFailure({ context, result, currentModel, round }) {
  const { requestId, stream, res } = context;
  const modelId = currentModel.model_id;

  if (result.noHealthyKeys) {
    addLog('error', `請求 #${requestId}：目前沒有健康的 API Key，停止模型切換。`);
    if (stream && res.headersSent) {
      sendStreamError({
        context,
        errorPayload: {
          message: 'Gateway 目前沒有健康的 API Key。',
          detail: result.errorText || '所有 Key 可能都已停用或正在冷卻。'
        }
      });
    } else {
      res.status(503).json({
        error: {
          message: 'Gateway 目前沒有健康的 API Key。',
          detail: result.errorText || '所有 Key 可能都已停用或正在冷卻。',
          type: 'service_unavailable_error',
          code: 'no_healthy_keys'
        }
      });
    }
    return { abortRequest: true };
  }

  if (result.fatal) {
    addLog('error', `請求 #${requestId}：遇到不可重試錯誤 HTTP ${result.statusCode}，停止調度。`);
    if (stream && res.headersSent) {
      sendStreamError({
        context,
        errorPayload: {
          message: result.errorText || '不可重試錯誤',
          detail: `HTTP ${result.statusCode}`
        }
      });
    } else {
      res.status(result.statusCode || 400).json({
        error: {
          message: result.errorText || '不可重試錯誤',
          type: 'invalid_request_error',
          code: 'fatal_error'
        }
      });
    }
    return { abortRequest: true };
  }

  if (result.forceFallbackModel) {
    markModelFailureCooldown(modelId, result.errorText || '模型層級失敗');
    addLog('warning', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪判定為模型層級失敗，跳過剩餘輪次並切換下一個模型。`);
    return { abortModel: true };
  }

  if (result.forceRetrySameModel) {
    if (result.contentValidationFailed) {
      addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪回傳格式失敗，立即重試同一模型。`);
      if (round < context.MAX_ROUNDS_PER_MODEL) return { continueRound: true };
    }
    if (result.streamReadFailed) {
      addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪發生串流讀取錯誤，排程進行下一輪重試。`);
      if (round < context.MAX_ROUNDS_PER_MODEL) return { continueRound: true };
    }
    addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪僅發生 Key 層級錯誤。`);
    if (round < context.MAX_ROUNDS_PER_MODEL) return { continueRound: true };
  }

  return {};
}

/**
 * 主調度入口：依模型順位逐一嘗試。
 *
 * @param {object} args
 * @param {object} args.context
 * @param {Array}  args.configuredModels
 * @param {object} args.sanitizedBody
 */
async function dispatchRequest({ context, configuredModels, sanitizedBody }) {
  const { requestId, stream, isClientGone, activeConfig, MAX_ROUNDS_PER_MODEL, MAX_EMPTY_RESPONSE_RETRIES } = context;
  const ROUND_DELAY_MS = activeConfig.ROUND_DELAY_MS;

  let skippedByCooldown = 0;

  for (let modelIndex = 0; modelIndex < configuredModels.length; modelIndex += 1) {
    if (isClientGone()) {
      addLog('warning', `請求 #${requestId}：客戶端已中斷，停止模型順位調度。`);
      return;
    }

    const currentModel = configuredModels[modelIndex];
    const modelId = currentModel.model_id;

    if (isModelInFailureCooldown(modelId)) {
      skippedByCooldown += 1;
      addLog('info', `請求 #${requestId}：模型「${modelId}」仍在暫時跳過狀態，直接嘗試下一個模型。`);
      continue;
    }

    addLog('info', `請求 #${requestId}：開始調度模型「${modelId}」（順位 ${currentModel.priority}）。`);

    let lastResultContentValidationFailed = false;
    let lastResultStreamReadFailed = false;

    for (let round = 1; round <= MAX_ROUNDS_PER_MODEL; round += 1) {
      if (round > 1) {
        if (lastResultContentValidationFailed) {
          addLog('info', `請求 #${requestId}：模型「${modelId}」因回傳格式失敗立即重試，不等待。`);
        } else if (lastResultStreamReadFailed) {
          addLog('info', `請求 #${requestId}：模型「${modelId}」因先前發生串流讀取錯誤，等待 ${ROUND_DELAY_MS / 1000} 秒後進入第 ${round} 輪重試。`);
          await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
        } else {
          addLog('info', `請求 #${requestId}：模型「${modelId}」只有 Key 層級錯誤，等待 ${ROUND_DELAY_MS / 1000} 秒後進入第 ${round} 輪。`);
          await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
        }
      }

      const result = await tryModelWithKeys({
        context,
        model: currentModel,
        roundNumber: round,
        sanitizedBody,
        MAX_EMPTY_RESPONSE_RETRIES
      });
      lastResultContentValidationFailed = !!(result && result.contentValidationFailed);
      lastResultStreamReadFailed = !!(result && result.streamReadFailed);

      if (result.clientGone) {
        addLog('warning', `請求 #${requestId}：客戶端已中斷，停止後續模型調度。`);
        return;
      }

      if (result.success) {
        const handled = await handleSuccessfulResult({ context, result, currentModel });
        if (handled.abortRequest) return;
        if (handled.abortModel) break;
        return;
      }

      const failure = handleRoundFailure({ context, result, currentModel, round });
      if (failure.abortRequest) return;
      if (failure.abortModel) break;
      if (failure.continueRound) continue;
    }

    addLog('warning', `請求 #${requestId}：模型「${modelId}」未能完成本次請求，嘗試下一個模型。`);
  }

  const cooldownText = skippedByCooldown > 0 ? `，其中 ${skippedByCooldown} 個模型因近期模型層級失敗被暫時跳過` : '';
  addLog('error', `請求 #${requestId}：所有模型都無法完成請求${cooldownText}。`);
  if (stream && context.res.headersSent) {
    return sendStreamError({
      context,
      errorPayload: {
        message: '所有設定中的模型都無法完成請求，請檢查 Gateway 日誌。',
        detail: `所有模型都無法完成請求${cooldownText}。`
      }
    });
  }
  return context.res.status(503).json({
    error: {
      message: '所有設定中的模型都無法完成請求，請檢查 Gateway 日誌。',
      detail: `所有模型都無法完成請求${cooldownText}。`,
      type: 'service_unavailable_error',
      code: 'all_models_failed'
    }
  });
}

module.exports = {
  dispatchRequest,
  handleDispatchError
};