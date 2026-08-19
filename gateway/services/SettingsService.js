const { settings } = require('../../database');
const { addLog } = require('../logs/logger');
const { broadcastEvent } = require('../utils/broadcast');
const { ValidationError } = require('../errors/GatewayError');

class SettingsService {
  getRawSettings() {
    return settings.get();
  }

  getFormattedSettings() {
    const current = settings.get();
    return {
      ...current,
      ROUND_DELAY_MS: current.ROUND_DELAY_MS / 1000,
      REQUEST_TIMEOUT_MS: current.REQUEST_TIMEOUT_MS / 1000,
      STREAM_READ_TIMEOUT_MS: current.STREAM_READ_TIMEOUT_MS / 1000,
      TEST_TIMEOUT_MS: current.TEST_TIMEOUT_MS / 1000,
      MODEL_FAILURE_COOLDOWN_MS: current.MODEL_FAILURE_COOLDOWN_MS / 1000,
      KEY_CONCURRENCY_DELAY_MS: current.KEY_CONCURRENCY_DELAY_MS / 1000
    };
  }

  validateSettings(payload) {
    const {
      PORT,
      ROUND_DELAY_MS,
      REQUEST_TIMEOUT_MS,
      STREAM_READ_TIMEOUT_MS,
      TEST_TIMEOUT_MS,
      MODEL_FAILURE_COOLDOWN_MS,
      KEY_CONCURRENCY_DELAY_MS,
      MAX_ROUNDS_PER_MODEL,
      MAX_EMPTY_RESPONSE_RETRIES,
      PRICE_PER_MILLION_PROMPT_TOKENS,
      PRICE_PER_MILLION_COMPLETION_TOKENS,
      REF_PRICE_PER_MILLION_PROMPT_TOKENS,
      REF_PRICE_PER_MILLION_COMPLETION_TOKENS
    } = payload;

    const validationErrors = [];
    if (PORT !== undefined) {
      const portNum = Number(PORT);
      if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535 || !Number.isInteger(portNum)) {
        validationErrors.push('PORT 必須是 1～65535 之間的整數。');
      }
    }
    if (ROUND_DELAY_MS !== undefined) {
      const val = Number(ROUND_DELAY_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('每輪重試等待時間必須至少 1 秒。');
      }
    }
    if (REQUEST_TIMEOUT_MS !== undefined) {
      const val = Number(REQUEST_TIMEOUT_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('請求逾時必須至少 1 秒。');
      }
    }
    if (STREAM_READ_TIMEOUT_MS !== undefined) {
      const val = Number(STREAM_READ_TIMEOUT_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('串流讀取逾時必須至少 1 秒。');
      }
    }
    if (TEST_TIMEOUT_MS !== undefined) {
      const val = Number(TEST_TIMEOUT_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('測試逾時必須至少 1 秒。');
      }
    }
    if (MODEL_FAILURE_COOLDOWN_MS !== undefined) {
      const val = Number(MODEL_FAILURE_COOLDOWN_MS);
      if (!Number.isFinite(val) || val < 0) {
        validationErrors.push('模型冷卻時間不可小於 0 秒。');
      }
    }
    if (KEY_CONCURRENCY_DELAY_MS !== undefined) {
      const val = Number(KEY_CONCURRENCY_DELAY_MS);
      if (!Number.isFinite(val) || val < 0) {
        validationErrors.push('金鑰防併發等待時間不可小於 0 秒。');
      }
    }
    if (MAX_ROUNDS_PER_MODEL !== undefined) {
      const val = Number(MAX_ROUNDS_PER_MODEL);
      if (!Number.isFinite(val) || val < 1 || val > 10 || !Number.isInteger(val)) {
        validationErrors.push('最大重試輪數必須是 1～10 之間的整數。');
      }
    }
    if (MAX_EMPTY_RESPONSE_RETRIES !== undefined) {
      const val = Number(MAX_EMPTY_RESPONSE_RETRIES);
      if (!Number.isFinite(val) || val < 1 || val > 10 || !Number.isInteger(val)) {
        validationErrors.push('空回傳重試次數必須是 1～10 之間的整數。');
      }
    }
    if (PRICE_PER_MILLION_PROMPT_TOKENS !== undefined && Number(PRICE_PER_MILLION_PROMPT_TOKENS) < 0) {
      validationErrors.push('Prompt 實際價格不可小於 0。');
    }
    if (PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined && Number(PRICE_PER_MILLION_COMPLETION_TOKENS) < 0) {
      validationErrors.push('Completion 實際價格不可小於 0。');
    }
    if (REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined && Number(REF_PRICE_PER_MILLION_PROMPT_TOKENS) < 0) {
      validationErrors.push('Prompt 參考價格不可小於 0。');
    }
    if (REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined && Number(REF_PRICE_PER_MILLION_COMPLETION_TOKENS) < 0) {
      validationErrors.push('Completion 參考價格不可小於 0。');
    }

    return validationErrors;
  }

  updateSettings(payload, requestId = null) {
    const errors = this.validateSettings(payload);
    if (errors.length > 0) {
      throw new ValidationError('設定驗證失敗', { requestId, details: errors });
    }

    const current = settings.get();
    const {
      ROUND_DELAY_MS,
      REQUEST_TIMEOUT_MS,
      STREAM_READ_TIMEOUT_MS,
      NVIDIA_API_URL,
      PORT,
      MAX_ROUNDS_PER_MODEL,
      MAX_EMPTY_RESPONSE_RETRIES,
      TEST_TIMEOUT_MS,
      MODEL_FAILURE_COOLDOWN_MS,
      KEY_CONCURRENCY_DELAY_MS,
      ENABLE_CONTENT_VALIDATION,
      PRICE_PER_MILLION_PROMPT_TOKENS,
      PRICE_PER_MILLION_COMPLETION_TOKENS,
      REF_PRICE_PER_MILLION_PROMPT_TOKENS,
      REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
      CURRENCY_SYMBOL
    } = payload;

    const updated = settings.save({
      ROUND_DELAY_MS: ROUND_DELAY_MS !== undefined ? Math.round(Number(ROUND_DELAY_MS) * 1000) : current.ROUND_DELAY_MS,
      REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS !== undefined ? Math.round(Number(REQUEST_TIMEOUT_MS) * 1000) : current.REQUEST_TIMEOUT_MS,
      STREAM_READ_TIMEOUT_MS: STREAM_READ_TIMEOUT_MS !== undefined ? Math.round(Number(STREAM_READ_TIMEOUT_MS) * 1000) : current.STREAM_READ_TIMEOUT_MS,
      NVIDIA_API_URL: NVIDIA_API_URL !== undefined ? String(NVIDIA_API_URL).trim() : current.NVIDIA_API_URL,
      PORT: PORT !== undefined ? Number(PORT) : current.PORT,
      MAX_ROUNDS_PER_MODEL: MAX_ROUNDS_PER_MODEL !== undefined ? Number(MAX_ROUNDS_PER_MODEL) : current.MAX_ROUNDS_PER_MODEL,
      MAX_EMPTY_RESPONSE_RETRIES: MAX_EMPTY_RESPONSE_RETRIES !== undefined ? Number(MAX_EMPTY_RESPONSE_RETRIES) : current.MAX_EMPTY_RESPONSE_RETRIES,
      TEST_TIMEOUT_MS: TEST_TIMEOUT_MS !== undefined ? Math.round(Number(TEST_TIMEOUT_MS) * 1000) : current.TEST_TIMEOUT_MS,
      MODEL_FAILURE_COOLDOWN_MS: MODEL_FAILURE_COOLDOWN_MS !== undefined ? Math.round(Number(MODEL_FAILURE_COOLDOWN_MS) * 1000) : current.MODEL_FAILURE_COOLDOWN_MS,
      KEY_CONCURRENCY_DELAY_MS: KEY_CONCURRENCY_DELAY_MS !== undefined ? Math.round(Number(KEY_CONCURRENCY_DELAY_MS) * 1000) : current.KEY_CONCURRENCY_DELAY_MS,
      ENABLE_CONTENT_VALIDATION: ENABLE_CONTENT_VALIDATION !== undefined ? Boolean(ENABLE_CONTENT_VALIDATION) : current.ENABLE_CONTENT_VALIDATION,
      PRICE_PER_MILLION_PROMPT_TOKENS: PRICE_PER_MILLION_PROMPT_TOKENS !== undefined ? Number(PRICE_PER_MILLION_PROMPT_TOKENS) : current.PRICE_PER_MILLION_PROMPT_TOKENS,
      PRICE_PER_MILLION_COMPLETION_TOKENS: PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined ? Number(PRICE_PER_MILLION_COMPLETION_TOKENS) : current.PRICE_PER_MILLION_COMPLETION_TOKENS,
      REF_PRICE_PER_MILLION_PROMPT_TOKENS: REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined ? Number(REF_PRICE_PER_MILLION_PROMPT_TOKENS) : current.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
      REF_PRICE_PER_MILLION_COMPLETION_TOKENS: REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined ? Number(REF_PRICE_PER_MILLION_COMPLETION_TOKENS) : current.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
      CURRENCY_SYMBOL: CURRENCY_SYMBOL !== undefined ? String(CURRENCY_SYMBOL).trim() : current.CURRENCY_SYMBOL
    });

    addLog('info', `已更新參數設定：每輪等待 ${(updated.ROUND_DELAY_MS / 1000)}秒, 請求逾時 ${(updated.REQUEST_TIMEOUT_MS / 1000)}秒, 串流逾時 ${(updated.STREAM_READ_TIMEOUT_MS / 1000)}秒, 測試逾時 ${(updated.TEST_TIMEOUT_MS / 1000)}秒, 模型失敗冷卻 ${(updated.MODEL_FAILURE_COOLDOWN_MS / 1000)}秒, 金鑰防併發等待 ${(updated.KEY_CONCURRENCY_DELAY_MS / 1000)}秒, URL: ${updated.NVIDIA_API_URL}, PORT: ${updated.PORT}, 最大重試: ${updated.MAX_ROUNDS_PER_MODEL}輪, 空回傳重試: ${updated.MAX_EMPTY_RESPONSE_RETRIES}次, 內容校驗: ${updated.ENABLE_CONTENT_VALIDATION ? '啟用' : '停用'}`, { requestId });

    const formatted = {
      ...updated,
      ROUND_DELAY_MS: updated.ROUND_DELAY_MS / 1000,
      REQUEST_TIMEOUT_MS: updated.REQUEST_TIMEOUT_MS / 1000,
      STREAM_READ_TIMEOUT_MS: updated.STREAM_READ_TIMEOUT_MS / 1000,
      TEST_TIMEOUT_MS: updated.TEST_TIMEOUT_MS / 1000,
      MODEL_FAILURE_COOLDOWN_MS: updated.MODEL_FAILURE_COOLDOWN_MS / 1000,
      KEY_CONCURRENCY_DELAY_MS: updated.KEY_CONCURRENCY_DELAY_MS / 1000
    };

    broadcastEvent('settings', formatted);
    return formatted;
  }
}

module.exports = new SettingsService();
