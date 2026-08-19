/**
 * Chat 請求上下文工廠（Chat Request Context）
 *
 * 將單一 /v1/chat/completions 請求所需的共享狀態封裝成一個物件，
 * 讓子模組（upstream / response / dispatch / modelRound）能以參數注入方式存取，
 * 避免依賴外層閉包或全域變數。
 *
 * 包含：
 *  - requestId：全域請求序號或追蹤 ID
 *  - stream：是否為串流模式
 *  - isClientGone()：客戶端連線是否已中斷
 *  - addLog(...)：日誌快捷（自動附加 requestId）
 *  - activeConfig：本次請求鎖定的設定快照
 *  - requestStartedAt：起始時間
 *  - fakeStreamController：假串流控制器（由 response/fakeStream 提供）
 */

const { addLog } = require('../../logs/logger');
const { getNextRequestSequence } = require('../../cooldown/modelCooldown');

function createChatContext({ req, res, originalBody, activeConfig }) {
  const sequenceNum = getNextRequestSequence();
  const requestId = req?.id || String(sequenceNum);
  const requestStartedAt = Date.now();
  const stream = !!originalBody.stream;

  let clientDisconnected = false;
  let responseFinished = false;

  const contextAddLog = (type, message) => {
    addLog(type, message, { requestId });
  };

  res.once('finish', () => {
    responseFinished = true;
    if (res.statusCode >= 400) {
      contextAddLog('error', `請求 #${requestId}：HTTP 回應完成但狀態碼為 ${res.statusCode}。`);
    }
  });

  res.once('close', () => {
    if (!responseFinished && !res.writableEnded) {
      clientDisconnected = true;
      contextAddLog('warning', `請求 #${requestId}：客戶端在 Gateway 回傳完成前中斷連線，停止後續模型調度。`);
    }
  });

  function isClientGone() {
    return clientDisconnected || req?.aborted || res?.destroyed || res?.writableEnded;
  }

  return {
    requestId,
    sequenceNum,
    stream,
    requestStartedAt,
    activeConfig,
    isClientGone,
    responseFinished: () => responseFinished,
    fakeStreamController: null,
    addLog: contextAddLog,
    res,
    req,
    originalBody,
    sanitizedBody: null
  };
}

/**
 * 從資料庫設定計算單一請求所需的最大重試上限：
 *  - MAX_ROUNDS_PER_MODEL：每個模型最多輪詢幾次
 *  - MAX_EMPTY_RESPONSE_RETRIES：同一模型最多允許連續空回傳次數
 *
 * 兩者皆限制在 1~10 之間，否則使用預設值（2 / 3）。
 */
function resolveRetryLimits(activeConfig) {
  const dbMaxRounds = Number(activeConfig.MAX_ROUNDS_PER_MODEL);
  const MAX_ROUNDS_PER_MODEL = (Number.isFinite(dbMaxRounds) && dbMaxRounds >= 1 && dbMaxRounds <= 10) ? dbMaxRounds : 2;

  const dbMaxEmptyRetries = Number(activeConfig.MAX_EMPTY_RESPONSE_RETRIES);
  const MAX_EMPTY_RESPONSE_RETRIES = (Number.isFinite(dbMaxEmptyRetries) && dbMaxEmptyRetries >= 1 && dbMaxEmptyRetries <= 10) ? dbMaxEmptyRetries : 3;

  return { MAX_ROUNDS_PER_MODEL, MAX_EMPTY_RESPONSE_RETRIES };
}

module.exports = {
  createChatContext,
  resolveRetryLimits
};