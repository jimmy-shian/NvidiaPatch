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

      // 建構後再檢查：剔除僅含假串流字元的 chunk，避免下游污染。
      const contentField =
        (chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) ||
        (chunk.choices[0] && chunk.choices[0].message && chunk.choices[0].message.content) ||
        (chunk.choices[0] && chunk.choices[0].text) ||
        (chunk.choices[0] && chunk.choices[0].content) ||
        '';
      if (typeof contentField === 'string' && !isFakeStreamContent(contentField)) {
        outputLines.push(`data: ${JSON.stringify(chunk)}`);
        validChunkCount += 1;
      }
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

module.exports = {
  buildSafeSsePayload
};