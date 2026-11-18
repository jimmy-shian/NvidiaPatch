/**
 * SSE Payload 建構器（Safe SSE Payload Builder）
 *
 * 將校驗後的 sseLines（NVIDIA 原始 SSE 行）整理成符合 OpenAI SSE 規範的
 * 最終 payload 給前端：
 *  - 補齊 id / object / created / model 等必要欄位
 *  - 略過解析失敗的行，避免前端 SSE parser 拋錯
 *  - 補上 data: [DONE] 作為串流結束
 *
 * 若經整理後沒有任何有效 chunk，回傳空字串（呼叫端應視為錯誤）。
 */

const { addLog } = require('../../logs/logger');
const { isFakeStreamContent } = require('../utils/fakeStreamFilter');

function buildSafeSsePayload({ requestId, sseLines, clientModelId = 'patcher-main' }) {
  const outputLines = [];
  let validChunkCount = 0;
  let hasFinishReason = false;
  let sawToolCalls = false;
  let lastChunkId = null;

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
      lastChunkId = chunk.id;
      chunk.object = chunk.object || 'chat.completion.chunk';
      chunk.created = chunk.created || Math.floor(Date.now() / 1000);
      chunk.model = clientModelId;

      // 保留僅含 usage 的結尾統計 chunk（choices 為空陣列）
      if (chunk.choices.length === 0) {
        if (chunk.usage) {
          outputLines.push(`data: ${JSON.stringify(chunk)}`);
          validChunkCount += 1;
        }
        continue;
      }

      const choice0 = chunk.choices[0];
      const delta = choice0?.delta;
      const msg = choice0?.message;
      const finishReason = choice0?.finish_reason;
      const hasToolCalls = Boolean(
        delta?.tool_calls ||
        delta?.function_call ||
        msg?.tool_calls ||
        msg?.function_call ||
        finishReason === 'tool_calls' ||
        finishReason === 'function_call'
      );
      if (hasToolCalls) {
        sawToolCalls = true;
      }
      if (finishReason) {
        hasFinishReason = true;
      }

      // 建構後再檢查：剔除僅含假串流字元的 chunk，避免下游污染。
      const contentField =
        (delta && (delta.content || delta.reasoning_content || delta.reasoning || delta.thought || delta.thinking)) ||
        (msg && (msg.content || msg.reasoning_content || msg.reasoning || msg.thought || msg.thinking)) ||
        (choice0 && choice0.text) ||
        (choice0 && choice0.content) ||
        '';

      if (hasToolCalls || typeof contentField !== 'string' || !isFakeStreamContent(contentField) || delta?.role || finishReason) {
        outputLines.push(`data: ${JSON.stringify(chunk)}`);
        validChunkCount += 1;
      }
    } catch (err) {
      addLog('warning', `請求 #${requestId}：略過一行無法解析的串流資料，避免傳給客戶端造成 OpenAI SSE 解析失敗。`);
    }
  }

  if (validChunkCount === 0) {
    return '';
  }

  // 若上游串流結束前未提供任何 finish_reason，補上一幀標準收尾 chunk（避免 OpenAI SDK / OpenCode 報 stream ended without finish_reason）
  if (!hasFinishReason) {
    const finishChunk = {
      id: lastChunkId || `chatcmpl-gateway-${requestId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: clientModelId,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: sawToolCalls ? 'tool_calls' : 'stop'
      }]
    };
    const lastLine = outputLines[outputLines.length - 1];
    let lastIsUsageOnly = false;
    if (lastLine) {
      try {
        const parsedLast = JSON.parse(lastLine.slice(5).trim());
        lastIsUsageOnly = Boolean(parsedLast && Array.isArray(parsedLast.choices) && parsedLast.choices.length === 0 && parsedLast.usage);
      } catch (_) {}
    }
    if (lastIsUsageOnly) {
      outputLines.splice(outputLines.length - 1, 0, `data: ${JSON.stringify(finishChunk)}`);
    } else {
      outputLines.push(`data: ${JSON.stringify(finishChunk)}`);
    }
  }

  outputLines.push('data: [DONE]');
  return `${outputLines.join('\n\n')}\n\n`;
}

module.exports = {
  buildSafeSsePayload
};