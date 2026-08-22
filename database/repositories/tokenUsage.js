const { getTaiwanISOString } = require('../../utils/date');

// Process-level in-memory Ring Buffer for volatile token usage history
const MAX_TOKEN_RECORDS = 50;

// Ring buffer of recent token usage logs (most recent at index 0)
const tokenRecords = [];
let nextRecordId = 1;

// Map: model_id -> { model_id, total_prompt_tokens, total_completion_tokens, total_total_tokens, request_count }
const modelStatsMap = new Map();

const tokenUsage = {
  /**
   * 新增 Token 用量紀錄 — 100% 純記憶體 Ring Buffer，0 次磁碟寫入與修剪
   */
  addRecord(requestId, modelId, promptTokens, completionTokens, requestBody, responseContent) {
    const timestamp = getTaiwanISOString();
    const pTokens = Number(promptTokens) || 0;
    const cTokens = Number(completionTokens) || 0;
    const total = pTokens + cTokens;
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody || {});
    const respStr = typeof responseContent === 'string' ? responseContent : String(responseContent || '');
    const id = nextRecordId++;

    const newRecord = {
      id,
      request_id: requestId || null,
      timestamp,
      model_id: modelId,
      prompt_tokens: pTokens,
      completion_tokens: cTokens,
      total_tokens: total,
      request_body: bodyStr,
      response_content: respStr
    };

    // 存入 Ring Buffer (最新在最前)
    tokenRecords.unshift(newRecord);
    if (tokenRecords.length > MAX_TOKEN_RECORDS) {
      tokenRecords.length = MAX_TOKEN_RECORDS;
    }

    // 同步 O(1) 累加各模型統計
    let stat = modelStatsMap.get(modelId);
    if (!stat) {
      stat = {
        model_id: modelId,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_total_tokens: 0,
        request_count: 0
      };
      modelStatsMap.set(modelId, stat);
    }
    stat.total_prompt_tokens += pTokens;
    stat.total_completion_tokens += cTokens;
    stat.total_total_tokens += total;
    stat.request_count += 1;
  },

  /**
   * 取得各模型的 Token 用量統計（以 total_tokens 降序排列）
   */
  getStats() {
    const list = Array.from(modelStatsMap.values()).map(s => ({ ...s }));
    list.sort((a, b) => (b.total_total_tokens || 0) - (a.total_total_tokens || 0));
    return list;
  },

  /**
   * 取得最近的 Token 用量紀錄
   */
  getLogs(limit = 100) {
    const targetLimit = Number(limit) || 100;
    return tokenRecords.slice(0, targetLimit).map(r => ({ ...r }));
  },

  /**
   * 依 ID 取得單筆 Token 用量詳細內容
   */
  getDetail(id) {
    const targetId = Number(id);
    const item = tokenRecords.find(r => r.id === targetId);
    return item ? { ...item } : null;
  },

  /**
   * 清空記憶體中所有 Token 紀錄與模型計數
   */
  clear() {
    tokenRecords.length = 0;
    modelStatsMap.clear();
  }
};

module.exports = tokenUsage;

