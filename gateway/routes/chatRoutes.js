const express = require('express');
const { apiKeys, modelsConfig, stats, tokenUsage, settings } = require('../../database');
const eventManager = require('../sse/eventManager');
const { addLog } = require('../logs/logger');
const { isModelInFailureCooldown, markModelFailureCooldown, getNextRequestSequence } = require('../cooldown/modelCooldown');
const { requireAdminAuth } = require('../middleware/auth');
const { resolveModelGroupFromRequest, buildOpenAiModelsListForGroup } = require('../utils/modelGroup');
const { sanitizeChatCompletionBody } = require('../utils/sanitize');
const { validateContent, formatValidationIssue } = require('../engine/contentValidator');
const ContentValidationError = require('../errors/ContentValidationError');

const router = express.Router();

router.post('/v1/chat/completions', async (req, res) => {
  const originalBody = req.body;
  const stream = !!originalBody.stream;
  const requestId = getNextRequestSequence();
  const requestStartedAt = Date.now();
  let clientDisconnected = false;
  let responseFinished = false;

  res.once('finish', () => {
    responseFinished = true;
    if (res.statusCode >= 400) {
      addLog('error', `請求 #${requestId}：HTTP 回應完成但狀態碼為 ${res.statusCode}。`);
    }
  });

  res.once('close', () => {
    if (!responseFinished && !res.writableEnded) {
      clientDisconnected = true;
      addLog('warning', `請求 #${requestId}：客戶端在 Gateway 回傳完成前中斷連線，停止後續模型調度。`);
    }
  });

  function isClientGone() {
    return clientDisconnected || req.aborted || res.destroyed || res.writableEnded;
  }

  const nvidiaBaseUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

  const groupSelection = resolveModelGroupFromRequest(req);
  const configuredModels = modelsConfig.getAll(groupSelection.groupId).filter(m => m.is_active === 1);
  if (configuredModels.length === 0) {
    const detail = groupSelection.fromClientKey
      ? `客戶端指定第 ${groupSelection.groupId} 組，但該組沒有任何啟用中的模型順位。`
      : `目前啟用的第 ${groupSelection.groupId} 組沒有任何啟用中的模型順位。`;
    addLog('error', `請求 #${requestId} 已拒絕：${detail}`);
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
  addLog('info', `請求 #${requestId} 已收到（stream=${stream}），${groupSourceText}模型順位，開始調度。`);

  const activeConfig = settings.get();
  const dbMaxRounds = Number(activeConfig.MAX_ROUNDS_PER_MODEL);
  const MAX_ROUNDS_PER_MODEL = (Number.isFinite(dbMaxRounds) && dbMaxRounds >= 1 && dbMaxRounds <= 10) ? dbMaxRounds : 2;
  const ROUND_DELAY_MS = activeConfig.ROUND_DELAY_MS;
  const REQUEST_TIMEOUT_MS = activeConfig.REQUEST_TIMEOUT_MS;
  const STREAM_READ_TIMEOUT_MS = activeConfig.STREAM_READ_TIMEOUT_MS;

  function getMaskedKey(keyValue) {
    const value = String(keyValue || '');
    return value ? `...${value.substring(Math.max(0, value.length - 8))}` : '未知 Key';
  }

  async function readTextSafely(response) {
    try {
      return await response.text();
    } catch (err) {
      return '';
    }
  }

  if (!global.keyNextRequestTimes) {
    global.keyNextRequestTimes = new Map();
  }

  async function sendSingleRequest(model, key, keyIndex, availableKeys) {
    const modelId = model.model_id;
    const sanitizedBody = sanitizeChatCompletionBody(originalBody);
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

    const now = Date.now();
    const nextAllowedTime = global.keyNextRequestTimes.get(key.id) || 0;
    const concurrencyDelayMs = Number(activeConfig.KEY_CONCURRENCY_DELAY_MS || 5000);

    let waitMs = 0;
    let scheduledTime = now;

    if (now < nextAllowedTime) {
      waitMs = nextAllowedTime - now;
      scheduledTime = nextAllowedTime;
    }

    global.keyNextRequestTimes.set(key.id, scheduledTime + concurrencyDelayMs);

    if (waitMs > 0) {
      addLog('info', `請求 #${requestId}：Key ID ${key.id} 已預約在 ${new Date(scheduledTime).toLocaleTimeString('zh-TW')} 送出（跨 Session 排隊等待 ${(waitMs / 1000).toFixed(2)} 秒）。`);
      await new Promise((resolve) => {
        const waitTimer = setTimeout(resolve, waitMs);
        const handleClose = () => {
          clearTimeout(waitTimer);
          resolve();
        };
        res.once('close', handleClose);
        res.once('finish', () => {
          res.off('close', handleClose);
        });
      });
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
      if (!responseFinished && !abortController.signal.aborted) {
        abortReason = 'client_disconnected';
        abortController.abort();
      }
    };
    res.once('close', abortOnClientDisconnect);

    try {
      const response = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
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
        const isContextLimit = errText.toLowerCase().includes('context length') || 
                               errText.toLowerCase().includes('context_length') || 
                               errText.toLowerCase().includes('max_tokens') ||
                               errText.toLowerCase().includes('max-tokens') ||
                               errText.toLowerCase().includes('token limit') ||
                               errText.toLowerCase().includes('too many tokens') ||
                               errText.toLowerCase().includes('max context') ||
                               errText.toLowerCase().includes('context window') ||
                               errText.toLowerCase().includes('context_window');
        const isDegraded = errText.toLowerCase().includes('degraded');
        if (isContextLimit || isDegraded) {
          if (isContextLimit) {
            addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 400（長度超出限制），判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
            apiKeys.recordFailure(key.id, `ModelContextLimit HTTP 400: ${errText.substring(0, 80)}`);
          } else {
            addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 400（模型已降級），判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
            apiKeys.recordFailure(key.id, `ModelDegraded HTTP 400: ${errText.substring(0, 80)}`);
          }
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

  function readStreamChunkWithTimeout(reader) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`串流讀取逾時 ${STREAM_READ_TIMEOUT_MS / 1000} 秒`));
      }, STREAM_READ_TIMEOUT_MS);

      reader.read()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async function validateSuccessfulResponse(model, selectedKey, result, roundNumber) {
    const modelId = model.model_id;
    const isStream = !!originalBody.stream;

    if (isStream) {
      const reader = result.response.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = '';
      let fullContent = '';
      const sseLines = [];
      let streamUsage = null;

      const consumeLine = (rawLine) => {
        const cleanLine = String(rawLine || '').endsWith('\r')
          ? String(rawLine || '').slice(0, -1)
          : String(rawLine || '');

        sseLines.push(cleanLine);
        
        const trimmed = cleanLine.trim();
        if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
          try {
            const dataStr = trimmed.slice(5).trim();
            const chunk = JSON.parse(dataStr);
            if (chunk?.choices?.[0]?.delta?.content) {
              fullContent += chunk.choices[0].delta.content;
            }
            if (chunk?.usage) {
              streamUsage = chunk.usage;
            }
          } catch (e) {
            // ignore
          }
        }
      };

      try {
        while (true) {
          if (isClientGone()) {
            throw new Error('客戶端已中斷連線');
          }
          const { done, value } = await readStreamChunkWithTimeout(reader);
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';

          for (const line of lines) {
            consumeLine(line);
          }
        }

        if (streamBuffer.trim()) {
          consumeLine(streamBuffer);
        }

              const validation = validateContent(fullContent, { maxLength: 10000 });
        if (!validation.valid) {
          const validationIssue = formatValidationIssue(validation);
          addLog('warning', `請求 #${requestId}：模型「${modelId}」串流內容校驗失敗（${validationIssue}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
          apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
          stats.recordRequest(false);
          return { success: false, retryScope: 'key', contentValidationFailed: true, errorText: `內容校驗失敗：${validationIssue}` };
        }

        if (!streamUsage) {
          const promptText = JSON.stringify(originalBody.messages || '');
          const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
          const estimatedCompletion = Math.max(1, Math.round(fullContent.length / 3.2));
          streamUsage = {
            prompt_tokens: estimatedPrompt,
            completion_tokens: estimatedCompletion,
            total_tokens: estimatedPrompt + estimatedCompletion
          };
        }

        return { success: true, response: result.response, sseLines, streamContent: fullContent, usage: streamUsage };
      } catch (err) {
        try {
          reader.cancel().catch(() => {});
        } catch (cancelErr) {
          // ignore
        }

        const isTimeout = err.message.includes('逾時') || err.message.toLowerCase().includes('timeout');
        if (isTimeout) {
          addLog('warning', `請求 #${requestId}：模型「${modelId}」串流讀取發生逾時（${err.message}），判定為模型層級失敗，立即切換下一個模型。`);
          apiKeys.recordFailure(selectedKey.id, `串流讀取逾時：${err.message}`);
          stats.recordRequest(false);
          return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: err.message };
        }

        addLog('warning', `請求 #${requestId}：模型「${modelId}」串流讀取或校驗失敗（${err.message}），判定為串流讀取錯誤，將進行後續等待與重試。`);
        apiKeys.recordFailure(selectedKey.id, `串流讀取錯誤：${err.message}`);
        stats.recordRequest(false);
        return { success: false, retryScope: 'key', streamReadFailed: true, errorText: err.message };
      }
    }

    try {
      const json = await result.response.json();
      const contentToCheck = json?.choices?.[0]?.message?.content || '';

        const validation = validateContent(contentToCheck, { maxLength: 10000 });
      if (!validation.valid) {
        const validationIssue = formatValidationIssue(validation);
        addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 內容校驗失敗（${validationIssue}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
        apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
        stats.recordRequest(false);
        return { success: false, retryScope: 'key', contentValidationFailed: true, errorText: `內容校驗失敗：${validationIssue}` };
      }

      let usage = json?.usage;
      if (!usage) {
        const promptText = JSON.stringify(originalBody.messages || '');
        const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
        const estimatedCompletion = Math.max(1, Math.round(contentToCheck.length / 3.2));
        usage = {
          prompt_tokens: estimatedPrompt,
          completion_tokens: estimatedCompletion,
          total_tokens: estimatedPrompt + estimatedCompletion
        };
      }

      return { success: true, response: result.response, jsonData: json, usage };
    } catch (err) {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 解析失敗（${err.message}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
      apiKeys.recordFailure(selectedKey.id, `JSON parse error: ${err.message}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'key', contentValidationFailed: true, errorText: err.message };
    }
  }

  async function tryModelWithKeys(model, roundNumber) {
    const modelId = model.model_id;
    const availableKeys = apiKeys.getActiveKeys();

    if (availableKeys.length === 0) {
      addLog('error', `請求 #${requestId}：模型「${modelId}」無法嘗試，因為目前沒有健康的 API Key。`);
      return { success: false, noHealthyKeys: true, errorText: '目前沒有健康的 API Key。' };
    }

    availableKeys.sort((a, b) => {
      const timeA = global.keyNextRequestTimes?.get(a.id) || 0;
      const timeB = global.keyNextRequestTimes?.get(b.id) || 0;
      return timeA - timeB;
    });

    addLog('info', `請求 #${requestId}：第 ${roundNumber}/${MAX_ROUNDS_PER_MODEL} 輪，嘗試模型「${modelId}」（順位 ${model.priority}），可用 Key 數：${availableKeys.length}。`);

    for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex += 1) {
      const selectedKey = availableKeys[keyIndex];
      addLog('info', `請求 #${requestId}：模型「${modelId}」使用 ${getMaskedKey(selectedKey.key_value)}（Key ${keyIndex + 1}/${availableKeys.length}，ID ${selectedKey.id}）。`);

      const result = await sendSingleRequest(model, selectedKey, keyIndex, availableKeys);

      if (result.clientGone) {
        return { success: false, clientGone: true, errorText: result.errorText || '客戶端已中斷連線' };
      }

      if (result.success) {
        const validated = await validateSuccessfulResponse(model, selectedKey, result, roundNumber);
        if (validated.success) return validated;

        if (validated.contentValidationFailed) {
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
          statusCode: result.statusCode,
          errorText: result.errorText || `HTTP ${result.statusCode}`
        };
      }

      addLog('info', `請求 #${requestId}：模型「${modelId}」遇到 Key 層級錯誤，繼續嘗試下一把 Key。`);
    }

    addLog('warning', `請求 #${requestId}：模型「${modelId}」本輪所有 Key 都因 Key 層級錯誤失敗。`);
    return { success: false, forceRetrySameModel: true, errorText: '本輪所有 Key 都因 Key 層級錯誤失敗。' };
  }

  function buildSafeSsePayload(sseLines, clientModelId = 'patcher-main') {
    const outputLines = [];
    let validChunkCount = 0;

    for (const rawLine of Array.isArray(sseLines) ? sseLines : []) {
      const trimmed = String(rawLine ?? '').trim();

      if (!trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const chunk = JSON.parse(dataStr);
        if (!chunk || typeof chunk !== 'object' || !Array.isArray(chunk.choices)) {
          continue;
        }

        chunk.id = chunk.id || `chatcmpl-gateway-${requestId}`;
        chunk.object = chunk.object || 'chat.completion.chunk';
        chunk.created = chunk.created || Math.floor(Date.now() / 1000);
        chunk.model = clientModelId;

        outputLines.push(`data: ${JSON.stringify(chunk)}`);
        validChunkCount += 1;
      } catch (err) {
        addLog('warning', `請求 #${requestId}：略過一行無法解析的 NVIDIA 串流資料，避免傳給 Cline 後造成 OpenAI SSE 解析失敗。`);
      }
    }

    if (validChunkCount === 0) {
      return '';
    }

    outputLines.push('data: [DONE]');
    return `${outputLines.join('\n\n')}\n\n`;
  }

  function waitForResponseFinish(sendAction) {
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

  async function sendValidatedResponse(result, currentModel) {
    const modelId = currentModel.model_id;
    const clientModelId = originalBody.model || 'patcher-main';

    if (isClientGone()) {
      throw new Error('客戶端已中斷連線，略過回傳。');
    }

    if (stream) {
      const ssePayload = buildSafeSsePayload(result.sseLines, clientModelId);
      if (!ssePayload || !ssePayload.includes('data:') || !ssePayload.includes('[DONE]')) {
        throw new Error('校驗後的串流內容是空的或格式不正確。');
      }

      await waitForResponseFinish(() => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        
        const chunks = ssePayload.split('\n\n');
        for (const chunk of chunks) {
          if (chunk.trim()) {
            res.write(chunk + '\n\n');
          }
        }
        res.end();
      });
    } else {
      const json = result.jsonData;
      if (json && typeof json === 'object') {
        json.model = clientModelId;
      }

      await waitForResponseFinish(() => {
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

      tokenUsage.addRecord(requestId, modelId, usage.prompt_tokens, usage.completion_tokens, originalBody.messages, responseContent);
      eventManager.broadcast('token-usage', { action: 'add', modelId, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
      addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。[Tokens: P:${usage.prompt_tokens} + C:${usage.completion_tokens} = T:${usage.prompt_tokens + usage.completion_tokens}]`);
    } catch (tokenErr) {
      console.error('Failed to record token usage:', tokenErr);
      addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。`);
    }
  }

  async function dispatchRequest() {
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

        const result = await tryModelWithKeys(currentModel, round);
        lastResultContentValidationFailed = !!(result && result.contentValidationFailed);
        lastResultStreamReadFailed = !!(result && result.streamReadFailed);

        if (result.clientGone) {
          addLog('warning', `請求 #${requestId}：客戶端已中斷，停止後續模型調度。`);
          return;
        }

        if (result.success) {
          try {
            await sendValidatedResponse(result, currentModel);
            return;
          } catch (err) {
            addLog('error', `請求 #${requestId}：模型「${modelId}」在 Gateway 包裝回傳時失敗（${err.message}），改切下一個模型。`);
            if (!res.headersSent && !res.writableEnded) {
              markModelFailureCooldown(modelId, `Gateway 回傳包裝失敗：${err.message}`);
              break;
            }
            try {
              res.end();
            } catch (endErr) {
              // ignore
            }
            return;
          }
        }

        if (result.noHealthyKeys) {
          addLog('error', `請求 #${requestId}：目前沒有健康的 API Key，停止模型切換。`);
          return res.status(503).json({
            error: {
              message: 'Gateway 目前沒有健康的 API Key。',
              detail: result.errorText || '所有 Key 可能都已停用或正在冷卻。',
              type: 'service_unavailable_error',
              code: 'no_healthy_keys'
            }
          });
        }

        if (result.fatal) {
          addLog('error', `請求 #${requestId}：遇到不可重試錯誤 HTTP ${result.statusCode}，停止調度。`);
          return res.status(result.statusCode || 400).json({
            error: {
              message: result.errorText || '不可重試錯誤',
              type: 'invalid_request_error',
              code: 'fatal_error'
            }
          });
        }

        if (result.forceFallbackModel) {
          markModelFailureCooldown(modelId, result.errorText || '模型層級失敗');
          addLog('warning', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪判定為模型層級失敗，跳過剩餘輪次並切換下一個模型。`);
          break;
        }

        if (result.forceRetrySameModel) {
          if (result.contentValidationFailed) {
            addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪回傳格式失敗，立即重試同一模型。`);
            if (round < MAX_ROUNDS_PER_MODEL) {
              continue;
            }
          }
          if (result.streamReadFailed) {
            addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪發生串流讀取錯誤，排程進行下一輪重試。`);
            if (round < MAX_ROUNDS_PER_MODEL) {
              continue;
            }
          }
          addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪僅發生 Key 層級錯誤。`);
          if (round < MAX_ROUNDS_PER_MODEL) {
            continue;
          }
        }
      }

      addLog('warning', `請求 #${requestId}：模型「${modelId}」未能完成本次請求，嘗試下一個模型。`);
    }

    const cooldownText = skippedByCooldown > 0 ? `，其中 ${skippedByCooldown} 個模型因近期模型層級失敗被暫時跳過` : '';
    addLog('error', `請求 #${requestId}：所有模型都無法完成請求${cooldownText}。`);
    return res.status(503).json({
      error: {
        message: '所有設定中的模型都無法完成請求，請檢查 Gateway 日誌。',
        detail: `所有模型都無法完成請求${cooldownText}。`,
        type: 'service_unavailable_error',
        code: 'all_models_failed'
      }
    });
  }

  try {
    await dispatchRequest();
  } catch (err) {
    addLog('error', `請求 #${requestId}：Gateway 調度流程發生未預期錯誤：${err.stack || err.message}`);
    stats.recordRequest(false);

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
});

router.post('/api/test/chat', requireAdminAuth, async (req, res) => {
  const { model, messages, stream, response_format } = req.body;
  
  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Model and messages array are required' });
  }

  const sanitized = sanitizeChatCompletionBody({ model, messages, stream, response_format });
  const cleanMessages = sanitized.messages;

  const activeKeys = apiKeys.getActiveKeys();
  if (activeKeys.length === 0) {
    return res.status(503).json({ error: 'No active/healthy API Keys available in the Gateway pool.' });
  }

  const nvidiaBaseUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

  async function attemptTestChat(keyIndex) {
    if (keyIndex >= activeKeys.length) {
      addLog('error', `[模型測試] 所有可用 Key（${activeKeys.length} 把）都無法測試模型「${model}」。`);
      return res.status(502).json({
        error: {
          message: `模型「${model}」測試失敗：所有可用 Key 都無法完成請求。`,
          type: 'api_error',
          code: 'all_keys_failed'
        }
      });
    }

    const selectedKey = activeKeys[keyIndex];
    addLog('info', `[模型測試] 使用 Key ...${selectedKey.key_value.substring(selectedKey.key_value.length - 8)} 測試模型「${model}」（第 ${keyIndex + 1}/${activeKeys.length} 把）。`);

    let abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 60000);

    try {
      const response = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${selectedKey.key_value}`
        },
        body: JSON.stringify({
          model,
          messages: cleanMessages,
          stream: !!stream,
          temperature: 1,
          ...(sanitized.response_format ? { response_format: sanitized.response_format } : {})
        }),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        addLog('warning', `[模型測試] Key ID ${selectedKey.id} 收到 NIM HTTP ${response.status}：${errText}`);

        if (response.status === 404 || response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
          if (response.status === 401 || response.status === 403) {
            apiKeys.updateStatus(selectedKey.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
          } else if (response.status === 429) {
            apiKeys.recordCooldown(selectedKey.id, 30, '429 Rate Limit Exceeded');
          }
          return attemptTestChat(keyIndex + 1);
        }

        return res.status(response.status).json({
          error: {
            message: errText,
            type: 'invalid_request_error',
            code: 'test_chat_error'
          }
        });
      }

      if (stream) {
        const reader = response.body.getReader();
        let fullContent = '';
        const contentBuffer = [];
        let validationFailed = false;

        function readTestChunk() {
          return reader.read().then(({ done, value }) => {
            if (done) {
        const validation = validateContent(fullContent, { maxLength: 10000 });
              if (!validation.valid) {
                validationFailed = true;
                addLog('error', `[模型測試｜內容校驗] 串流回應被拒收：偵測到不合法或未閉合標籤：${formatValidationIssue(validation)}。`);
                throw new ContentValidationError(fullContent);
              }
              res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              for (const chunk of contentBuffer) {
                res.write(chunk);
              }
              res.end();
              return;
            }
            const text = new TextDecoder().decode(value);
            const lines = text.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
                try {
                  const dataStr = trimmed.slice(5).trim();
                  const parsed = JSON.parse(dataStr);
                  if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                    fullContent += parsed.choices[0].delta.content;
                  }
                } catch (e) {
                  // ignore
                }
              }
            }
            contentBuffer.push(value);
            return readTestChunk();
          });
        }

        try {
          await readTestChunk();
        } catch (err) {
          if (err.name === 'ContentValidationError') {
            addLog('error', `[模型測試] 內容在送到前端前校驗失敗，改用下一把 Key 重新生成。`);
            return attemptTestChat(keyIndex + 1);
          }
          addLog('error', `[模型測試] 串流讀取錯誤：${err.message}`);
          if (!res.headersSent) {
            return res.status(502).json({
              error: {
                message: `串流讀取錯誤：${err.message}`,
                type: 'api_error',
                code: 'stream_error'
              }
            });
          }
          res.end();
        }
      } else {
        const json = await response.json();
        let contentToCheck = '';
        if (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) {
          contentToCheck = json.choices[0].message.content;
        }
        
      const validation = validateContent(contentToCheck, { maxLength: 10000 });
        if (!validation.valid) {
          const validationIssue = formatValidationIssue(validation);
          addLog('error', `[模型測試｜內容校驗] 非串流回應被拒收：偵測到不合法或未閉合標籤：${validationIssue}，改用下一把 Key 重新生成。`);
          return attemptTestChat(keyIndex + 1);
        }

        res.json(json);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      addLog('warning', `[模型測試] Key ID ${selectedKey.id} 請求失敗：${err.message}`);
      return attemptTestChat(keyIndex + 1);
    }
  }

  await attemptTestChat(0);
});

module.exports = router;
