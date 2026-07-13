const { getDb } = require('../connection');
const { getTaiwanISOString } = require('../../utils/date');

const tokenUsage = {
  addRecord(requestId, modelId, promptTokens, completionTokens, requestBody, responseContent) {
    const db = getDb();
    const timestamp = getTaiwanISOString();
    const total = (promptTokens || 0) + (completionTokens || 0);
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody || {});
    const respStr = responseContent || '';
    db.prepare(`
      INSERT INTO token_usage (request_id, timestamp, model_id, prompt_tokens, completion_tokens, total_tokens, request_body, response_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestId || null, timestamp, modelId, promptTokens || 0, completionTokens || 0, total, bodyStr, respStr);

    try {
      db.exec(`
        UPDATE token_usage 
        SET request_body = '', response_content = '' 
        WHERE id NOT IN (
          SELECT id FROM token_usage 
          ORDER BY id DESC 
          LIMIT 50
        )
      `);
    } catch (err) {
      console.error('Failed to prune old token_usage prompt contents:', err);
    }
  },
  getStats() {
    return getDb().prepare(`
      SELECT 
        model_id,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_tokens) as total_total_tokens,
        COUNT(id) as request_count
      FROM token_usage
      GROUP BY model_id
      ORDER BY total_total_tokens DESC
    `).all();
  },
  getLogs(limit = 100) {
    return getDb().prepare(`
      SELECT id, request_id, timestamp, model_id, prompt_tokens, completion_tokens, total_tokens, request_body, response_content
      FROM token_usage
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  },
  getDetail(id) {
    return getDb().prepare(`
      SELECT id, request_id, timestamp, model_id, prompt_tokens, completion_tokens, total_tokens, request_body, response_content
      FROM token_usage
      WHERE id = ?
    `).get(id);
  },
  clear() {
    getDb().exec("DELETE FROM token_usage");
  }
};

module.exports = tokenUsage;
