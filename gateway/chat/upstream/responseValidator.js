/**
 * 回傳校驗（Response Validator）
 *
 * 當 sendSingleRequest 拿到 HTTP 200 的 response 後，此模組負責：
 *
 *  1. 串流模式：消費 reader，逐行解析 SSE chunk，將多種可能欄位
 *     (delta.content / delta.reasoning_content / message.content / text / content)
 *     合併為 fullContent；最終交給 smartValidate 校驗。
 *     - 空內容 → 重試同一模型（forceRetrySameModelOnEmpty）
 *     - 校驗失敗 → 切換模型（forceFallbackModel）
 *     - 逾時 / 客戶端中斷 → 對應分支
 *
 *  2. 非串流模式：await response.json() 後校驗 choices[0].message.content
 *     - 空內容 / 校驗失敗 → 同上
 *     - JSON 解析失敗 → 換下一把 Key（retryScope='key'）
 */

const { apiKeys, stats } = require('../../../database');
const { addLog } = require('../../logs/logger');
const { smartValidate, formatValidationIssue } = require('../../engine/contentValidator');
const { isFakeStreamContent } = require('../utils/fakeStreamFilter');

function isUpstreamErrorContent(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim().toLowerCase();
  if (trimmed.length > 500) return false;
  return trimmed === 'internal server error'
    || trimmed === '"internal server error"'
    || trimmed === 'bad gateway'
    || trimmed === 'service unavailable'
    || trimmed === 'gateway timeout'
    || /^\{?\s*"error"\s*:\s*"internal server error"/.test(trimmed)
    || /^\{?\s*"error"\s*:\s*\{\s*"message"\s*:\s*"internal server error"/.test(trimmed)
    || /^\s*5\d{2}\s+(internal server error|bad gateway|service unavailable|gateway timeout)\s*$/i.test(trimmed);
}

function readStreamChunkWithTimeout(reader, STREAM_READ_TIMEOUT_MS) {
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

function consumeSseLine(rawLine, sseLines, fullContentRef, finishReasonRef) {
  const cleanLine = String(rawLine || '').endsWith('\r')
    ? String(rawLine || '').slice(0, -1)
    : String(rawLine || '');

  sseLines.push(cleanLine);

  const trimmed = cleanLine.trim();
  if (!trimmed.startsWith('data:') || trimmed.includes('[DONE]')) return;

  try {
    const dataStr = trimmed.slice(5).trim();
    const chunk = JSON.parse(dataStr);

    // 過濾僅含假串流字元 \uE000 的 chunk，避免汙染校驗用的 fullContent。
    const fakeCandidate = chunk?.choices?.[0]?.delta?.content
      || chunk?.choices?.[0]?.delta?.reasoning_content
      || chunk?.choices?.[0]?.message?.content
      || chunk?.choices?.[0]?.message?.reasoning_content
      || chunk?.choices?.[0]?.text
      || chunk?.choices?.[0]?.content;
    if (typeof fakeCandidate === 'string' && isFakeStreamContent(fakeCandidate)) {
      return chunk?.usage || null;
    }

    // 記錄 finish_reason（如 "length" 表示輸出被截斷），供後續判斷是否需重試。
    const finishReason = chunk?.choices?.[0]?.finish_reason;
    if (finishReason && finishReasonRef && !finishReasonRef.value) {
      finishReasonRef.value = finishReason;
    }

    // 支援多種可能欄位
    if (chunk?.choices?.[0]?.delta?.content) {
      fullContentRef.value += chunk.choices[0].delta.content;
    }
    if (chunk?.choices?.[0]?.delta?.reasoning_content) {
      fullContentRef.value += chunk.choices[0].delta.reasoning_content;
    }
    if (chunk?.choices?.[0]?.message?.content) {
      fullContentRef.value += chunk.choices[0].message.content;
    }
    if (chunk?.choices?.[0]?.text) {
      fullContentRef.value += chunk.choices[0].text;
    }
    if (chunk?.choices?.[0]?.content) {
      fullContentRef.value += chunk.choices[0].content;
    }
    return chunk?.usage || null;
  } catch (e) {
    return null;
  }
}

async function validateStreamResponse({ context, model, selectedKey, result }) {
  const { requestId, originalBody, activeConfig, isClientGone } = context;
  const modelId = model.model_id;
  const STREAM_READ_TIMEOUT_MS = activeConfig.STREAM_READ_TIMEOUT_MS;

  const reader = result.response.body.getReader();
  const decoder = new TextDecoder();
  let streamBuffer = '';
  const sseLines = [];
  const fullContentRef = { value: '' };
  const finishReasonRef = { value: null };
  let streamUsage = null;

  try {
    while (true) {
      if (isClientGone()) {
        throw new Error('客戶端已中斷連線');
      }
      const { done, value } = await readStreamChunkWithTimeout(reader, STREAM_READ_TIMEOUT_MS);
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() || '';

      for (const line of lines) {
        const usage = consumeSseLine(line, sseLines, fullContentRef, finishReasonRef);
        if (usage) streamUsage = usage;
      }
    }

    const fullContent = fullContentRef.value;

    // 若 NVIDIA 回傳 finish_reason = "length"，表示輸出因 max_tokens 被截斷，
    // 視為模型層級失敗，立即切換下一個模型（或重試），避免把不完整內容當成功回傳。
    if (finishReasonRef.value === 'length') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」串流輸出因 max_tokens 被截斷（finish_reason="length"），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: finish_reason=length (truncated)`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `內容校驗失敗：輸出被截斷（finish_reason="length"）` };
    }

    if (!activeConfig.ENABLE_CONTENT_VALIDATION) {
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
    }

    if (fullContent === null || fullContent === undefined || fullContent === '') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」串流內容為空，判定為空回傳，將依空回傳重試策略重試同一模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Empty content`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceRetrySameModelOnEmpty: true, emptyResponse: true, statusCode: 0, errorText: `內容校驗失敗：回傳內容為空` };
    }

    if (isUpstreamErrorContent(fullContent)) {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」串流回傳 HTTP 200 但內容為上游錯誤訊息（${fullContent.substring(0, 120)}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Upstream error in 200 body: ${fullContent.substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `HTTP 200 但內容為上游錯誤：${fullContent.substring(0, 120)}` };
    }

    const validation = smartValidate(fullContent, { maxLength: 10000 });
    if (!validation.valid) {
      const validationIssue = formatValidationIssue(validation);
      addLog('warning', `請求 #${requestId}：模型「${modelId}」串流內容校驗失敗（${validationIssue}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `內容校驗失敗：${validationIssue}` };
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

    const isClientDisconnect = err.message.includes('客戶端已中斷連線');
    const isTimeout = err.message.includes('逾時') || err.message.toLowerCase().includes('timeout');
    if (isClientDisconnect) {
      apiKeys.recordFailure(selectedKey.id, `客戶端中斷連線：${err.message}`);
      stats.recordRequest(false);
      return { success: false, clientGone: true, errorText: err.message };
    }
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

async function validateJsonResponse({ context, model, selectedKey, result }) {
  const { requestId, originalBody, activeConfig } = context;
  const modelId = model.model_id;

  try {
    const json = await result.response.json();
    const finishReason = json?.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 輸出因 max_tokens 被截斷（finish_reason="length"），判定為模型層級失敗，切換下一個模型重試。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: finish_reason=length (truncated)`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `內容校驗失敗：輸出被截斷（finish_reason="length"）` };
    }

    const contentToCheck = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.message?.reasoning_content || '';

    if (!activeConfig.ENABLE_CONTENT_VALIDATION) {
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
    }

    if (contentToCheck === '') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 內容為空，判定為空回傳，將依空回傳重試策略重試同一模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Empty content`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceRetrySameModelOnEmpty: true, emptyResponse: true, statusCode: 0, errorText: `內容校驗失敗：回傳內容為空` };
    }

    if (isUpstreamErrorContent(contentToCheck)) {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 回傳 HTTP 200 但內容為上游錯誤訊息（${contentToCheck.substring(0, 120)}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Upstream error in 200 body: ${contentToCheck.substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `HTTP 200 但內容為上游錯誤：${contentToCheck.substring(0, 120)}` };
    }

    const validation = smartValidate(contentToCheck, { maxLength: 10000 });
    if (!validation.valid) {
      const validationIssue = formatValidationIssue(validation);
      addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 內容校驗失敗（${validationIssue}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `內容校驗失敗：${validationIssue}` };
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

/**
 * 校驗 NVIDIA HTTP 200 回應（串流 / 非串流分支）。
 *
 * @returns 與原始 validateSuccessfulResponse 相同的結果物件結構
 */
async function validateSuccessfulResponse({ context, model, selectedKey, result, roundNumber }) {
  if (result.passthrough) {
    return passthroughStreamResponse({ context, model, selectedKey, result });
  }
  const isStream = !!context.originalBody.stream;
  if (isStream) {
    return validateStreamResponse({ context, model, selectedKey, result });
  }
  return validateJsonResponse({ context, model, selectedKey, result });
}

/**
 * 即時透傳上游串流：邊讀邊直接寫到 res，不累積 fullContent。
 *
 * 只在 ENABLE_CONTENT_VALIDATION === false 且客戶端 stream=true 時呼叫。
 *
 * - 逐 chunk 從上游 reader 讀出，立即 pipe 給 responseWriter。
 * - 解析每個 data chunk，嘗試抓 usage；累計 content 字數供 fallback 估算。
 * - 客戶端中斷 / 讀取逾時 / 其他錯誤統一回傳失敗物件，由 dispatch 處理。
 *
 * 此函式本身不會對 res 做任何寫入或 end()，僅把 chunks 與 metadata
 * 交給 responseWriter.sendPassthroughResponse。
 */
async function passthroughStreamResponse({ context, model, selectedKey, result }) {
  const { requestId, originalBody, activeConfig, isClientGone } = context;
  const modelId = model.model_id;
  const STREAM_READ_TIMEOUT_MS = activeConfig.STREAM_READ_TIMEOUT_MS;

  const reader = result.response.body.getReader();
  const decoder = new TextDecoder();
  let streamBuffer = '';
  let upstreamUsage = null;
  let contentLength = 0;
  let lastChunkBytes = null;
  let rawLines = [];

  try {
    while (true) {
      if (isClientGone()) {
        throw new Error('客戶端已中斷連線');
      }
      const { done, value } = await readStreamChunkWithTimeout(reader, STREAM_READ_TIMEOUT_MS);
      if (done) break;

      lastChunkBytes = value;
      rawLines.push(value);

      const text = decoder.decode(value, { stream: true });
      streamBuffer += text;

      let newlineIdx;
      while ((newlineIdx = streamBuffer.indexOf('\n')) !== -1) {
        const rawLine = streamBuffer.slice(0, newlineIdx);
        streamBuffer = streamBuffer.slice(newlineIdx + 1);

        const cleanLine = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const trimmed = cleanLine.trim();
        if (!trimmed.startsWith('data:') || trimmed.includes('[DONE]')) continue;

        try {
          const chunk = JSON.parse(trimmed.slice(5).trim());
          if (chunk?.usage) upstreamUsage = chunk.usage;

          const c = chunk?.choices?.[0]?.delta?.content
            || chunk?.choices?.[0]?.delta?.reasoning_content
            || chunk?.choices?.[0]?.message?.content
            || chunk?.choices?.[0]?.message?.reasoning_content
            || chunk?.choices?.[0]?.text
            || chunk?.choices?.[0]?.content
            || '';
          if (typeof c === 'string') contentLength += c.length;
        } catch (e) {
          // 解析失敗不影響透傳
        }
      }
    }

    let usage = upstreamUsage;
    if (!usage) {
      const promptText = JSON.stringify(originalBody.messages || '');
      const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
      const estimatedCompletion = Math.max(1, Math.round(contentLength / 3.2));
      usage = {
        prompt_tokens: estimatedPrompt,
        completion_tokens: estimatedCompletion,
        total_tokens: estimatedPrompt + estimatedCompletion
      };
    }

    return {
      success: true,
      passthrough: true,
      response: result.response,
      streamContent: '',
      rawChunks: rawLines,
      lastChunkBytes,
      usage
    };
  } catch (err) {
    try {
      reader.cancel().catch(() => {});
    } catch (cancelErr) {
      // ignore
    }

    const isClientDisconnect = err.message.includes('客戶端已中斷連線');
    const isTimeout = err.message.includes('逾時') || err.message.toLowerCase().includes('timeout');
    if (isClientDisconnect) {
      apiKeys.recordFailure(selectedKey.id, `客戶端中斷連線：${err.message}`);
      stats.recordRequest(false);
      return { success: false, clientGone: true, errorText: err.message };
    }
    if (isTimeout) {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」透傳串流讀取發生逾時（${err.message}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `透傳串流讀取逾時：${err.message}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: err.message };
    }

    addLog('warning', `請求 #${requestId}：模型「${modelId}」透傳串流讀取失敗（${err.message}），判定為串流讀取錯誤，將進行後續等待與重試。`);
    apiKeys.recordFailure(selectedKey.id, `透傳串流讀取錯誤：${err.message}`);
    stats.recordRequest(false);
    return { success: false, retryScope: 'key', streamReadFailed: true, errorText: err.message };
  }
}

module.exports = {
  validateSuccessfulResponse,
  passthroughStreamResponse,
  readStreamChunkWithTimeout,
  consumeSseLine,
  isUpstreamErrorContent
};