/**
 * 單一模型多 Key 嘗試（Try Model With Keys）
 *
 * 從 apiKeys.getActiveKeys() 取得目前可用的金鑰列表，
 * 依「下一次可送出時間」排序後逐一嘗試：
 *
 *  - 對每把 Key 呼叫 sendSingleRequest
 *  - 成功 → 呼叫 validateSuccessfulResponse；若成功則回傳
 *  - 空回傳 → 最多 MAX_EMPTY_RESPONSE_RETRIES 次重試同一 Key
 *  - contentValidationFailed → forceRetrySameModel
 *  - streamReadFailed → forceRetrySameModel
 *  - model 層級失敗 → forceFallbackModel
 *  - fatal → fatal 旗標
 *  - key 層級錯誤 → 換下一把 Key 繼續
 */

const { apiKeys } = require('../../../database');
const { addLog } = require('../../logs/logger');
const { maskKeyValue } = require('../../utils/keyMasking');
const { sortKeysByAvailability } = require('../keyQueue');
const { sendSingleRequest } = require('../upstream/sendSingleRequest');
const { validateSuccessfulResponse } = require('../upstream/responseValidator');
const { isCustomUpstreamUrl } = require('../../utils/urlHelper');

/**
 * 對單一模型 + 多把 Key 進行嘗試，含空回傳重試迴圈。
 *
 * @param {object} args
 * @param {object} args.context
 * @param {object} args.model
 * @param {number} args.roundNumber
 * @param {object} args.sanitizedBody
 * @param {number} args.MAX_EMPTY_RESPONSE_RETRIES
 */
async function tryModelWithKeys({ context, model, roundNumber, sanitizedBody, MAX_EMPTY_RESPONSE_RETRIES }) {
  const { requestId, activeConfig } = context;
  const modelId = model.model_id;
  let availableKeys = apiKeys.getActiveKeys();

  if (availableKeys.length === 0) {
    if (isCustomUpstreamUrl(activeConfig?.NVIDIA_API_URL)) {
      // 本地端點 / 自訂端點（Ollama, LM Studio 等）：免配置 Key 即可以 Local 虛擬 Key 運作
      availableKeys = [{ id: 'local', key_value: 'local-key', status: 'active' }];
    } else {
      addLog('error', `請求 #${requestId}：模型「${modelId}」無法嘗試，因為目前沒有健康的 API Key。`);
      return { success: false, noHealthyKeys: true, errorText: '目前沒有健康的 API Key。' };
    }
  }

  const sortedKeys = sortKeysByAvailability(availableKeys, activeConfig);

  addLog('info', `請求 #${requestId}：第 ${roundNumber} 輪，嘗試模型「${modelId}」（順位 ${model.priority}），可用 Key 數：${sortedKeys.length}。`);

  for (let keyIndex = 0; keyIndex < sortedKeys.length; keyIndex += 1) {
    const selectedKey = sortedKeys[keyIndex];
    addLog('info', `請求 #${requestId}：模型「${modelId}」使用 ${maskKeyValue(selectedKey.key_value)}（Key ${keyIndex + 1}/${sortedKeys.length}，ID ${selectedKey.id}）。`);

    const result = await sendSingleRequest({
      context,
      model,
      key: selectedKey,
      keyIndex,
      availableKeys: sortedKeys,
      sanitizedBody
    });

    if (result.clientGone) {
      return { success: false, clientGone: true, errorText: result.errorText || '客戶端已中斷連線' };
    }

    if (result.success) {
      const validated = await validateSuccessfulResponse({ context, model, selectedKey, result, roundNumber });
      if (validated.success) return validated;

      if (validated.contentValidationFailed && validated.retryScope === 'key') {
        addLog('info', `請求 #${requestId}：模型「${modelId}」回傳格式失敗（${validated.errorText}），觸發同模型重試。`);
        return {
          success: false,
          forceRetrySameModel: true,
          contentValidationFailed: true,
          errorText: validated.errorText || '回傳格式失敗'
        };
      }

      if (validated.streamReadFailed) {
        addLog('warning', `請求 #${requestId}：模型「${modelId}」串流讀取失敗（${validated.errorText}），將觸發等待後重試。`);
        return {
          success: false,
          forceRetrySameModel: true,
          streamReadFailed: true,
          errorText: validated.errorText || '串流讀取失敗'
        };
      }

      if (validated.emptyResponse && validated.forceRetrySameModelOnEmpty) {
        let emptyRetryCount = 1;
        let lastValidated = validated;
        while (emptyRetryCount < MAX_EMPTY_RESPONSE_RETRIES) {
          addLog('info', `請求 #${requestId}：模型「${modelId}」回傳為空（空回傳第 ${emptyRetryCount}/${MAX_EMPTY_RESPONSE_RETRIES} 次），立即重試同一模型。`);
          const retryResult = await sendSingleRequest({
            context,
            model,
            key: selectedKey,
            keyIndex,
            availableKeys: sortedKeys,
            sanitizedBody
          });
          if (retryResult.clientGone) {
            return { success: false, clientGone: true, errorText: retryResult.errorText || '客戶端已中斷連線' };
          }
          if (retryResult.success) {
            const validatedRetry = await validateSuccessfulResponse({ context, model, selectedKey, result: retryResult, roundNumber });
            if (validatedRetry.success) return validatedRetry;
            lastValidated = validatedRetry;
            if (validatedRetry.emptyResponse && validatedRetry.forceRetrySameModelOnEmpty) {
              emptyRetryCount += 1;
              continue;
            }
            if (validatedRetry.contentValidationFailed && validatedRetry.retryScope === 'key') {
              addLog('info', `請求 #${requestId}：模型「${modelId}」空回傳重試轉為格式失敗，觸發同模型重試。`);
              return {
                success: false,
                forceRetrySameModel: true,
                contentValidationFailed: true,
                errorText: validatedRetry.errorText || '回傳格式失敗'
              };
            }
            if (validatedRetry.streamReadFailed) {
              addLog('warning', `請求 #${requestId}：模型「${modelId}」空回傳重試轉為串流讀取失敗，將觸發等待後重試。`);
              return {
                success: false,
                forceRetrySameModel: true,
                streamReadFailed: true,
                errorText: validatedRetry.errorText || '串流讀取失敗'
              };
            }
            if (validatedRetry.forceFallbackModel || validatedRetry.retryScope === 'model') {
              return {
                success: false,
                forceFallbackModel: true,
                errorText: validatedRetry.errorText || '模型回傳內容無效'
              };
            }
            continue;
          }
          if (retryResult.fatal || retryResult.retryScope === 'fatal') {
            return {
              success: false,
              fatal: true,
              statusCode: retryResult.statusCode,
              errorText: retryResult.errorText,
              response: retryResult.response
            };
          }
          if (retryResult.shouldFallbackModel || retryResult.retryScope === 'model') {
            addLog('warning', `請求 #${requestId}：模型「${modelId}」空回傳重試期間發生模型層級失敗，立即切換下一個模型。`);
            return {
              success: false,
              forceFallbackModel: true,
              statusCode: retryResult.statusCode,
              errorText: retryResult.errorText || `HTTP ${retryResult.statusCode}`
            };
          }
          addLog('info', `請求 #${requestId}：模型「${modelId}」空回傳重試遇到 Key 層級錯誤，繼續嘗試下一把 Key。`);
          lastValidated = { emptyResponse: true, forceRetrySameModelOnEmpty: true, errorText: retryResult.errorText };
          emptyRetryCount += 1;
        }
        addLog('warning', `請求 #${requestId}：模型「${modelId}」連續 ${emptyRetryCount} 次空回傳，已達上限（${MAX_EMPTY_RESPONSE_RETRIES} 次），判定為模型層級失敗，切換下一個模型。`);
        return {
          success: false,
          forceFallbackModel: true,
          errorText: lastValidated?.errorText || `連續空回傳 ${emptyRetryCount} 次`
        };
      }

      if (validated.forceFallbackModel || validated.retryScope === 'model') {
        return {
          success: false,
          forceFallbackModel: true,
          errorText: validated.errorText || '模型回傳內容無效'
        };
      }

      continue;
    }

    if (result.fatal || result.retryScope === 'fatal') {
      return {
        success: false,
        fatal: true,
        statusCode: result.statusCode,
        errorText: result.errorText,
        response: result.response
      };
    }

    if (result.shouldFallbackModel || result.retryScope === 'model') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」發生模型層級失敗（${result.errorText || `HTTP ${result.statusCode}` }），立即略過剩餘 Key 並切換下一個模型。`);
      return {
        success: false,
        forceFallbackModel: true,
        isContextLimit: Boolean(result.isContextLimit),
        statusCode: result.statusCode,
        errorText: result.errorText || `HTTP ${result.statusCode}`
      };
    }

    addLog('info', `請求 #${requestId}：模型「${modelId}」遇到 Key 層級錯誤，繼續嘗試下一把 Key。`);
  }

  addLog('warning', `請求 #${requestId}：模型「${modelId}」本輪所有 Key 都因 Key 層級錯誤失敗。`);
  return { success: false, forceRetrySameModel: true, errorText: '本輪所有 Key 都因 Key 層級錯誤失敗。' };
}

module.exports = {
  tryModelWithKeys
};