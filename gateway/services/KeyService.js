const { apiKeys } = require('../../database');
const { maskKeyRow } = require('../utils/keyMasking');
const { addLog } = require('../logs/logger');
const { broadcastEvent } = require('../utils/broadcast');
const { ValidationError, NotFoundError } = require('../errors/GatewayError');

class KeyService {
  getAllKeys() {
    return apiKeys.getAll();
  }

  getMaskedKeys() {
    const all = apiKeys.getAll();
    return all.map(maskKeyRow);
  }

  getActiveKeys() {
    return apiKeys.getActiveKeys();
  }

  getKeyStatus(id) {
    return apiKeys.getKeyStatus(id);
  }

  addKey(rawKey, requestId = null) {
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      throw new ValidationError('API Key is required', { requestId });
    }
    const key = rawKey.trim();
    const result = apiKeys.add(key);
    if (!result.success) {
      throw new ValidationError(result.error || 'Failed to add API Key', { requestId });
    }

    addLog('info', `已新增 API Key：${key.substring(0, 10)}...`, { requestId });
    broadcastEvent('keys', { action: 'add' });
    return { success: true };
  }

  deleteKey(id, requestId = null) {
    if (!id) {
      throw new ValidationError('Key ID is required', { requestId });
    }
    apiKeys.delete(id);
    addLog('info', `已刪除 API Key ID：${id}`, { requestId });
    broadcastEvent('keys', { action: 'delete', id });
    return { success: true };
  }

  async testAllKeys(requestId = null) {
    addLog('info', '開始手動測試所有 API Key 連線狀態。', { requestId });
    const results = await apiKeys.testAllKeys();
    const successCount = results.filter(r => r.success).length;
    addLog('info', `API Key 測試完成：${successCount}/${results.length} 把 Key 可用。`, { requestId });
    broadcastEvent('keys', {
      action: 'test',
      results: results.map(r => ({ id: r.id, status: r.status, success: r.success }))
    });
    return results;
  }
}

module.exports = new KeyService();
