/**
 * 回傳校驗（Response Validator）
 *
 * 當 sendSingleRequest 拿到 HTTP 200 的 response 後，此模組負責：
 *
 *  1. 串流模式：消費 reader，逐行解析 SSE chunk，將多種可能欄位
 *     (delta.content / delta.reasoning_content / message.content / text / content)
 *     合併為 fullContent；最終交給 smartValidate 校驗。
 *     - 上游錯誤 / 審查拒絕 → 切換模型（forceFallbackModel）
 *     - 空內容 → 依空回傳策略重試同一模型（forceRetrySameModelOnEmpty）
 *     - 校驗失敗 → 切換模型（forceFallbackModel）
 *     - 逾時 / 客戶端中斷 → 對應分支
 *
 *  2. 非串流模式：await response.json() 後校驗 choices[0].message.content
 *     - 空內容 / 校驗失敗 → 同上
 *     - JSON 解析失敗 → 換下一把 Key（retryScope='key'）
 */

const { apiKeys, stats } = require('../../../database');
const { addLog } = require('../../logs/logger');
const { smartValidate, formatValidationIssue, isUpstreamErrorContent, extractUpstreamErrorDetail } = require('../../engine/contentValidator');
const { isFakeStreamContent } = require('../utils/fakeStreamFilter');

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

function consumeSseLine(rawLine, sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef = { dataChunkCount: 0, lastError: null, refusal: null }) {
  const cleanLine = String(rawLine || '').endsWith('\r')
    ? String(rawLine || '').slice(0, -1)
    : String(rawLine || '');

  sseLines.push(cleanLine);

  const trimmed = cleanLine.trim();
  if (!trimmed.startsWith('data:') || trimmed.includes('[DONE]')) return null;

  try {
    const dataStr = trimmed.slice(5).trim();
    const chunk = JSON.parse(dataStr);
    if (streamMetaRef) streamMetaRef.dataChunkCount = (streamMetaRef.dataChunkCount || 0) + 1;

    // 檢查上游是否在 SSE chunk 中夾帶錯誤資訊
    if (chunk?.error) {
      const errDetail = extractUpstreamErrorDetail(chunk.error) || JSON.stringify(chunk.error);
      if (streamMetaRef) streamMetaRef.lastError = errDetail;
    } else if (chunk?.message && isUpstreamErrorContent(chunk.message)) {
      if (streamMetaRef) streamMetaRef.lastError = String(chunk.message);
    }

    const delta = chunk?.choices?.[0]?.delta;
    const msg = chunk?.choices?.[0]?.message;

    // 檢查是否有拒絕回覆（Refusal / Moderation）
    if (delta?.refusal || msg?.refusal) {
      if (streamMetaRef) streamMetaRef.refusal = delta?.refusal || msg?.refusal;
    }

    // 檢查是否有 tool_calls / function_call
    if (delta?.tool_calls || delta?.function_call || msg?.tool_calls || msg?.function_call) {
      if (hasToolCallsRef) hasToolCallsRef.value = true;
    }

    // 記錄 finish_reason（如 "length", "content_filter", "tool_calls", "stop"）
    const finishReason = chunk?.choices?.[0]?.finish_reason;
    if (finishReason && finishReasonRef && !finishReasonRef.value) {
      finishReasonRef.value = finishReason;
    }
    if (finishReason === 'tool_calls' || finishReason === 'function_call') {
      if (hasToolCallsRef) hasToolCallsRef.value = true;
    }

    // 過濾僅含假串流字元 \uE000 的 chunk，避免汙染校驗用的 fullContent。
    const fakeCandidate = delta?.content
      || delta?.reasoning_content
      || delta?.reasoning
      || delta?.thought
      || delta?.thinking
      || msg?.content
      || msg?.reasoning_content
      || msg?.reasoning
      || msg?.thought
      || msg?.thinking
      || chunk?.choices?.[0]?.text
      || chunk?.choices?.[0]?.content;
    if (typeof fakeCandidate === 'string' && isFakeStreamContent(fakeCandidate)) {
      return chunk?.usage || null;
    }

    // 支援多種可能欄位（含思考過程 reasoning / thinking / thought 等）
    if (delta?.content) {
      fullContentRef.value += delta.content;
    }
    if (delta?.reasoning_content) {
      fullContentRef.value += delta.reasoning_content;
    }
    if (delta?.reasoning) {
      fullContentRef.value += delta.reasoning;
    }
    if (delta?.thought) {
      fullContentRef.value += delta.thought;
    }
    if (delta?.thinking) {
      fullContentRef.value += delta.thinking;
    }
    if (msg?.content) {
      fullContentRef.value += msg.content;
    }
    if (msg?.reasoning_content) {
      fullContentRef.value += msg.reasoning_content;
    }
    if (msg?.reasoning) {
      fullContentRef.value += msg.reasoning;
    }
    if (msg?.thought) {
      fullContentRef.value += msg.thought;
    }
    if (msg?.thinking) {
      fullContentRef.value += msg.thinking;
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
  const hasToolCallsRef = { value: false };
  const streamMeta = { dataChunkCount: 0, lastError: null, refusal: null };
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
        const usage = consumeSseLine(line, sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMeta);
        if (usage) streamUsage = usage;
      }
    }

    // SSE does not guarantee a final newline. Flush TextDecoder at EOF and
    // consume the remaining event so a valid last data frame is not silently
    // mistaken for an empty response.
    const decoderTail = decoder.decode();
    if (decoderTail) streamBuffer += decoderTail;
    if (streamBuffer) {
      const trailingLines = streamBuffer.split('\n');
      streamBuffer = '';
      for (const line of trailingLines) {
        const usage = consumeSseLine(line, sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMeta);
        if (usage) streamUsage = usage;
      }
    }

    const fullContent = fullContentRef.value;
    const hasToolCalls = hasToolCallsRef.value || finishReasonRef.value === 'tool_calls' || finishReasonRef.value === 'function_call';

    // 1. 檢查上游 SSE chunk 是否夾帶明確錯誤物件
    if (streamMeta.lastError || (fullContent && isUpstreamErrorContent(fullContent))) {
      const errDetail = streamMeta.lastError || extractUpstreamErrorDetail(fullContent);
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[API 端伺服器錯誤 (HTTP 200 假成功)] 上游回傳內容包含錯誤訊息（${errDetail}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Upstream error in 200 body: ${errDetail.substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[API 端伺服器錯誤] 上游回傳錯誤：${errDetail}` };
    }

    // 2. 檢查安全過濾 / 拒絕回覆（finish_reason="content_filter" 或 refusal）
    if (finishReasonRef.value === 'content_filter' || streamMeta.refusal) {
      const refusalMsg = streamMeta.refusal ? `，拒絕原因：${streamMeta.refusal}` : '';
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[輸入端內容審查 / 安全拒絕] 觸發上游安全審查機制（finish_reason="content_filter"${refusalMsg}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: content_filter / refusal${refusalMsg}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[輸入端內容審查] 觸發上游安全審查機制（finish_reason="content_filter"${refusalMsg}）` };
    }

    // 3. 檢查輸出是否因 max_tokens 被截斷
    if (finishReasonRef.value === 'length') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[輸出長度截斷] 串流輸出因 max_tokens 被截斷（finish_reason="length"），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: finish_reason=length (truncated)`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[輸出長度截斷] 輸出因達到 max_tokens 上限被截斷（finish_reason="length"）` };
    }

    // 4. 檢查空內容（若有 tool_calls 或 function_call 則為正常的工具調用，不判定為空內容）
    if (!hasToolCalls && !String(fullContent || '').trim()) {
      let emptyDetail = '';
      if (streamMeta.dataChunkCount === 0) {
        emptyDetail = `[API 端異常] 上游建立 HTTP 200 連線但未發送任何 Chunk（接收 0 個 Chunk）即結束連線`;
      } else if (finishReasonRef.value === 'stop') {
        emptyDetail = `[模型回傳為空] 上游完成推論（finish_reason="stop"，接收 ${streamMeta.dataChunkCount} 個 Chunk）但未輸出任何內容 Token（可能是輸入格式或 Prompt 導致模型無輸出）`;
      } else {
        emptyDetail = `[模型回傳為空] 上游串流內容為空（接收 ${streamMeta.dataChunkCount} 個 Chunk，finish_reason="${finishReasonRef.value || 'none'}"）`;
      }
      addLog('warning', `請求 #${requestId}：模型「${modelId}」${emptyDetail}，將依空回傳重試策略重試同一模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Empty content (${streamMeta.dataChunkCount} chunks, reason: ${finishReasonRef.value || 'none'})`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceRetrySameModelOnEmpty: true, emptyResponse: true, statusCode: 0, errorText: `內容校驗失敗：${emptyDetail}` };
    }

    if (!activeConfig.ENABLE_CONTENT_VALIDATION) {
      if (!streamUsage) {
        const promptText = JSON.stringify(originalBody.messages || '');
        const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
        const estimatedCompletion = Math.max(1, Math.round((fullContent || '').length / 3.2));
        streamUsage = {
          prompt_tokens: estimatedPrompt,
          completion_tokens: estimatedCompletion,
          total_tokens: estimatedPrompt + estimatedCompletion
        };
      }
      return { success: true, response: result.response, sseLines, streamContent: fullContent, usage: streamUsage };
    }

    if (fullContent && fullContent.trim()) {
      const validation = smartValidate(fullContent, { maxLength: 10000 });
      if (!validation.valid) {
        const validationIssue = formatValidationIssue(validation);
        addLog('warning', `請求 #${requestId}：模型「${modelId}」[模型生成標記校驗失敗] 串流內容包含異常或未閉合標記（${validationIssue}），判定為模型層級失敗，立即切換下一個模型。`);
        apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
        stats.recordRequest(false);
        return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[模型生成標記校驗失敗] ${validationIssue}` };
      }
    }

    if (!streamUsage) {
      const promptText = JSON.stringify(originalBody.messages || '');
      const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
      const estimatedCompletion = Math.max(1, Math.round((fullContent || '').length / 3.2));
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
      const timeoutDesc = `[API 端讀取超時] 上游串流讀取逾時（已等待 ${STREAM_READ_TIMEOUT_MS / 1000} 秒，累計接收 ${streamMeta.dataChunkCount} 個 Chunk，上游節點排隊過載無響應）`;
      addLog('warning', `請求 #${requestId}：模型「${modelId}」${timeoutDesc}，判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `串流讀取逾時（${streamMeta.dataChunkCount} chunks）：${err.message}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: timeoutDesc };
    }

    addLog('warning', `請求 #${requestId}：模型「${modelId}」[API 端串流錯誤] 串流讀取或校驗失敗（${err.message}），判定為串流讀取錯誤，將進行後續等待與重試。`);
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
    const targetMsg = json?.choices?.[0]?.message;
    const hasToolCalls = Boolean(
      targetMsg?.function_call ||
      targetMsg?.tool_calls ||
      finishReason === 'tool_calls' ||
      finishReason === 'function_call'
    );
    const contentToCheck = targetMsg?.content || targetMsg?.reasoning_content || targetMsg?.reasoning || targetMsg?.thought || targetMsg?.thinking || '';

    // 1. 檢查上游 JSON 或內容是否為伺服器錯誤結構
    if (isUpstreamErrorContent(json) || (contentToCheck && isUpstreamErrorContent(contentToCheck))) {
      const errDetail = extractUpstreamErrorDetail(json) || extractUpstreamErrorDetail(contentToCheck) || '上游伺服器內部錯誤';
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[API 端伺服器錯誤 (HTTP 200 假成功)] JSON 回傳 HTTP 200 但內容為上游錯誤訊息（${errDetail}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Upstream error in 200 body: ${errDetail.substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[API 端伺服器錯誤] HTTP 200 但內容為上游錯誤：${errDetail}` };
    }

    // 2. 檢查安全過濾 / 拒絕回覆
    if (finishReason === 'content_filter' || targetMsg?.refusal) {
      const refusalMsg = targetMsg?.refusal ? `，拒絕原因：${targetMsg.refusal}` : '';
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[輸入端內容審查 / 安全拒絕] 觸發上游安全審查機制（finish_reason="content_filter"${refusalMsg}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: content_filter / refusal${refusalMsg}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[輸入端內容審查] 觸發上游安全審查機制（finish_reason="content_filter"${refusalMsg}）` };
    }

    // 3. 檢查輸出截斷
    if (finishReason === 'length') {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[輸出長度截斷] JSON 輸出因 max_tokens 被截斷（finish_reason="length"），判定為模型層級失敗，切換下一個模型重試。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: finish_reason=length (truncated)`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[輸出長度截斷] 輸出因達到 max_tokens 上限被截斷（finish_reason="length"）` };
    }

    // 4. 檢查空內容（若有 tool_calls 或 function_call 則為正常工具調用，不判定為空內容）
    if (!hasToolCalls && contentToCheck === '') {
      let emptyDetail = '';
      if (finishReason === 'stop') {
        emptyDetail = `[模型回傳為空] 上游模型完成推論（finish_reason="stop"）但 JSON 內容為空（可能是輸入格式或 Prompt 導致模型無輸出）`;
      } else {
        emptyDetail = `[模型回傳為空] 上游 JSON 內容為空（finish_reason="${finishReason || 'none'}"）`;
      }
      addLog('warning', `請求 #${requestId}：模型「${modelId}」${emptyDetail}，將依空回傳重試策略重試同一模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Empty JSON content (reason: ${finishReason || 'none'})`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceRetrySameModelOnEmpty: true, emptyResponse: true, statusCode: 0, errorText: `內容校驗失敗：${emptyDetail}` };
    }

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

    const validation = smartValidate(contentToCheck, { maxLength: 10000 });
    if (!validation.valid) {
      const validationIssue = formatValidationIssue(validation);
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[模型生成標記校驗失敗] JSON 內容包含異常或未閉合標記（${validationIssue}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[模型生成標記校驗失敗] ${validationIssue}` };
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
    addLog('warning', `請求 #${requestId}：模型「${modelId}」[API 端格式錯誤] JSON 解析失敗（${err.message}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
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
  let hasUpstreamError = false;
  let upstreamErrorDetail = '';
  let chunkCount = 0;

  try {
    while (true) {
      if (isClientGone()) {
        throw new Error('客戶端已中斷連線');
      }
      const { done, value } = await readStreamChunkWithTimeout(reader, STREAM_READ_TIMEOUT_MS);
      if (done) break;

      chunkCount += 1;
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
          if (typeof c === 'string') {
            contentLength += c.length;
            if (contentLength <= 500 && isUpstreamErrorContent(c)) {
              hasUpstreamError = true;
              upstreamErrorDetail = extractUpstreamErrorDetail(c) || c;
            }
          }
          if (chunk?.error || (chunk?.message && isUpstreamErrorContent(chunk.message))) {
            hasUpstreamError = true;
            upstreamErrorDetail = extractUpstreamErrorDetail(chunk.error || chunk.message);
          }
        } catch (e) {
          // 解析失敗不影響透傳
        }
      }
    }

    if (hasUpstreamError) {
      addLog('warning', `請求 #${requestId}：模型「${modelId}」[API 端伺服器錯誤 (HTTP 200 假成功)] 透傳串流中檢測到上游錯誤訊息（${String(upstreamErrorDetail).substring(0, 120)}），判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `ContentValidation: Upstream error in passthrough stream: ${String(upstreamErrorDetail).substring(0, 80)}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: `[API 端伺服器錯誤] 透傳串流中包含上游錯誤：${String(upstreamErrorDetail).substring(0, 120)}` };
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
      const timeoutDesc = `[API 端讀取超時] 透傳串流讀取逾時（已等待 ${STREAM_READ_TIMEOUT_MS / 1000} 秒，累計接收 ${chunkCount} 個 Chunk，上游節點排隊過載無響應）`;
      addLog('warning', `請求 #${requestId}：模型「${modelId}」${timeoutDesc}，判定為模型層級失敗，立即切換下一個模型。`);
      apiKeys.recordFailure(selectedKey.id, `透傳串流讀取逾時（${chunkCount} chunks）：${err.message}`);
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: timeoutDesc };
    }

    addLog('warning', `請求 #${requestId}：模型「${modelId}」[API 端串流錯誤] 透傳串流讀取失敗（${err.message}），判定為串流讀取錯誤，將進行後續等待與重試。`);
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