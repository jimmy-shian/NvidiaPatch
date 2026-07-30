/**
 * 單把金鑰請求（Send Single Request）
 *
 * 對 NVIDIA API 發送一次 chat/completions 請求，並依 HTTP 狀態碼分類
 * 處理結果：
 *
 *  - 200：記錄成功，回傳 response 物件供校驗模組使用
 *  - 429：設金鑰 30 秒冷卻，建議換下一把 Key（retryScope='key'）
 *  - 401/403：將金鑰停用，建議換下一把 Key（retryScope='key'）
 *  - 404 / >=500：記錄失敗，立即切換下一個模型（retryScope='model'）
 *  - 400：若是 context limit / degraded，視為模型層級失敗；
 *         否則視為不可重試錯誤（retryScope='fatal'）
 *  - 其他 4xx：不可重試錯誤（retryScope='fatal'）
 *
 * 另含：
 *  - 排隊等待（金鑰冷卻跨 Session 排隊）
 *  - 逾時中斷（REQUEST_TIMEOUT_MS）
 *  - 客戶端中斷（AbortController + res close 監聽）
 */

const { apiKeys, stats } = require('../../../database');
const { addLog } = require('../../logs/logger');
const { reserveSlot, waitForSlot } = require('../keyQueue');
const { readTextSafely } = require('../utils/readTextSafely');

const NVIDIA_BASE_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

function isContextLimitError(errText) {
  const lower = String(errText || '').toLowerCase();
  return lower.includes('context length')
    || lower.includes('context_length')
    || lower.includes('max_tokens')
    || lower.includes('max-tokens')
    || lower.includes('token limit')
    || lower.includes('too many tokens')
    || lower.includes('max context')
    || lower.includes('context window')
    || lower.includes('context_window');
}

function isDegradedError(errText) {
  return String(errText || '').toLowerCase().includes('degraded');
}

/**
 * 對指定模型+金鑰發送一次請求。
 *
 * @param {object} args
 * @param {object} args.context      - createChatContext() 產生的請求上下文
 * @param {object} args.model        - modelsConfig 模型物件
 * @param {object} args.key          - apiKeys 金鑰物件
 * @param {number} args.keyIndex
 * @param {Array}  args.availableKeys
 * @param {object} args.sanitizedBody - sanitizeChatCompletionBody() 結果
 * @returns {Promise<{success, retryScope, response?, errorText?, statusCode?, clientGone?, fatal?, shouldFallbackModel?}>}
 */
async function sendSingleRequest({ context, model, key, keyIndex, availableKeys, sanitizedBody }) {
  const { requestId, isClientGone, activeConfig, res } = context;
  const modelId = model.model_id;
  const REQUEST_TIMEOUT_MS = activeConfig.REQUEST_TIMEOUT_MS;

  const forwardBody = {
    ...sanitizedBody,
    model: modelId,
    temperature: 1
  };

  const preQueueStatus = apiKeys.getKeyStatus(key.id);
  if (preQueueStatus !== 'active') {
    addLog('warning', `請求 #${requestId}：金鑰 ID ${key.id} 目前狀態為「${preQueueStatus}」（非 active），直接跳過。`);
    return { success: false, retryScope: 'key', errorText: `金鑰狀態為 ${preQueueStatus}` };
  }

  const { waitMs, scheduledTime } = reserveSlot(key.id, activeConfig);

  if (waitMs > 0) {
    addLog('info', `請求 #${requestId}：Key ID ${key.id} 已預約在 ${new Date(scheduledTime).toLocaleTimeString('zh-TW')} 送出（跨 Session 排隊等待 ${(waitMs / 1000).toFixed(2)} 秒）。`);
    await waitForSlot(res, waitMs);
  }

  const postSleepStatus = apiKeys.getKeyStatus(key.id);
  if (postSleepStatus !== 'active') {
    addLog('warning', `請求 #${requestId}：金鑰 ID ${key.id} 在排隊等待期間狀態變更為「${postSleepStatus}」，取消本次發送。`);
    return { success: false, retryScope: 'key', errorText: `金鑰狀態已在等待期變更為 ${postSleepStatus}` };
  }

  if (isClientGone()) {
    addLog('warning', `請求 #${requestId}：金鑰排隊等待完成後檢測到用戶端已中斷連線，取消對 Key ID ${key.id} 的 NVIDIA 請求發送。`);
    return { success: false, clientGone: true, errorText: '用戶端已於等待期間中斷連線' };
  }

  const abortController = new AbortController();
  let abortReason = 'timeout';
  const timeoutId = setTimeout(() => {
    abortReason = 'timeout';
    abortController.abort();
  }, REQUEST_TIMEOUT_MS);

  const abortOnClientDisconnect = () => {
    if (!context.responseFinished() && !abortController.signal.aborted) {
      abortReason = 'client_disconnected';
      abortController.abort();
    }
  };
  res.once('close', abortOnClientDisconnect);

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key.key_value}`
      },
      body: JSON.stringify(forwardBody),
      signal: abortController.signal
    });

    clearTimeout(timeoutId);
    res.off('close', abortOnClientDisconnect);

    if (response.ok) {
      apiKeys.recordSuccess(key.id);
      const passthroughEligible = activeConfig.ENABLE_CONTENT_VALIDATION === false;
      if (passthroughEligible && context.stream) {
        addLog('info', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 收到 NVIDIA HTTP 200，校驗已關閉，改採即時透傳以降低延遲。`);
        return { success: true, response, retryScope: 'none', passthrough: true };
      }
      addLog('info', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 收到 NVIDIA HTTP 200，開始校驗回傳內容。`);
      return { success: true, response, retryScope: 'none' };
    }

    if (response.status === 429) {
      const errText = await readTextSafely(response);
      addLog('warning', `請求 #${requestId}：Key ID ${key.id} 遇到 429 速率限制，該 Key 進入 30 秒冷卻，改用下一把 Key 繼續同一模型「${modelId}」。`);
      apiKeys.recordCooldown(key.id, 30, errText || '429 Rate Limit Exceeded');
      stats.recordRequest(false);
      return { success: false, retryScope: 'key', statusCode: 429, errorText: errText || '429 Rate Limit Exceeded' };
    }

    if (response.status === 401 || response.status === 403) {
      const errText = await readTextSafely(response);
      addLog('error', `請求 #${requestId}：Key ID ${key.id} 回傳 HTTP ${response.status}，已設為停用，改用下一把 Key 繼續同一模型「${modelId}」。`);
      apiKeys.updateStatus(key.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'key', statusCode: response.status, errorText: errText };
    }

    if (response.status === 404) {
      const errText = await readTextSafely(response);
      addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 404，判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
      apiKeys.recordFailure(key.id, `ModelNotFound HTTP 404: ${errText.substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 404, errorText: errText || 'HTTP 404' };
    }

    if (response.status >= 500) {
      const errText = await readTextSafely(response);
      addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP ${response.status}，判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
      apiKeys.recordFailure(key.id, `ModelServerError HTTP ${response.status}: ${errText.substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: response.status, errorText: errText || `HTTP ${response.status}` };
    }

    if (response.status === 400) {
      const errText = await readTextSafely(response);
      if (isContextLimitError(errText)) {
        addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 400（長度超出限制），判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
        apiKeys.recordFailure(key.id, `ModelContextLimit HTTP 400: ${errText.substring(0, 80)}`);
        stats.recordRequest(false);
        return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 400, errorText: errText };
      }
      if (isDegradedError(errText)) {
        addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 400（模型已降級），判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
        apiKeys.recordFailure(key.id, `ModelDegraded HTTP 400: ${errText.substring(0, 80)}`);
        stats.recordRequest(false);
        return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 400, errorText: errText };
      }
      addLog('error', `請求 #${requestId}：NVIDIA 回傳不可重試的 HTTP ${response.status}，停止本次調度。錯誤：${errText.substring(0, 200)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'fatal', fatal: true, statusCode: response.status, errorText: errText, response };
    }

    const errText = await readTextSafely(response);
    addLog('error', `請求 #${requestId}：NVIDIA 回傳不可重試的 HTTP ${response.status}，停止本次調度。錯誤：${errText.substring(0, 200)}`);
    stats.recordRequest(false);
    return { success: false, retryScope: 'fatal', fatal: true, statusCode: response.status, errorText: errText, response };

  } catch (err) {
    clearTimeout(timeoutId);
    res.off('close', abortOnClientDisconnect);

    if (err.name === 'AbortError') {
      if (abortReason === 'client_disconnected' || isClientGone()) {
        addLog('warning', `請求 #${requestId}：客戶端已中斷連線，取消模型「${modelId}」的 NVIDIA 請求。`);
        stats.recordRequest(false);
        return { success: false, clientGone: true, retryScope: 'client', errorText: '客戶端已中斷連線' };
      }
      const msg = `請求逾時 ${REQUEST_TIMEOUT_MS / 1000} 秒`;
      addLog('warning', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 發生逾時，立即切換下一個模型，不再測試此模型的其他 Key。`);
      apiKeys.recordFailure(key.id, msg);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 0, errorText: msg };
    }

    addLog('warning', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 發生網路或連線錯誤，立即切換下一個模型。錯誤：${err.message}`);
    apiKeys.recordFailure(key.id, `Network Error: ${err.message}`);
    stats.recordRequest(false);
    return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 0, errorText: err.message };
  }
}

module.exports = {
  sendSingleRequest,
  isContextLimitError,
  isDegradedError
};