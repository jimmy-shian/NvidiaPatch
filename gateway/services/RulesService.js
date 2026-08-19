const { rules } = require('../../database');
const { addLog } = require('../logs/logger');
const { broadcastEvent } = require('../utils/broadcast');
const { ValidationError } = require('../errors/GatewayError');

class RulesService {
  getAllRules() {
    return rules.getAll();
  }

  addRule(title, content, requestId = null) {
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new ValidationError('Title is required', { requestId });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new ValidationError('Content is required', { requestId });
    }
    const result = rules.add(title.trim(), content.trim());
    if (!result.success) {
      throw new ValidationError(result.error || 'Failed to add rule', { requestId });
    }
    addLog('info', `已新增自訂規範：「${title.trim()}」`, { requestId });
    broadcastEvent('rules', { action: 'add' });
    return { success: true };
  }

  updateRule(id, title, content, requestId = null) {
    if (!id) {
      throw new ValidationError('Rule ID is required', { requestId });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new ValidationError('Title is required', { requestId });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new ValidationError('Content is required', { requestId });
    }
    const result = rules.update(id, title.trim(), content.trim());
    if (!result.success) {
      throw new ValidationError(result.error || 'Failed to update rule (preset rules cannot be edited)', { requestId });
    }
    addLog('info', `已更新自訂規範 ID：${id}`, { requestId });
    broadcastEvent('rules', { action: 'update', id });
    return { success: true };
  }

  deleteRule(id, requestId = null) {
    if (!id) {
      throw new ValidationError('Rule ID is required', { requestId });
    }
    const result = rules.delete(id);
    if (!result.success) {
      throw new ValidationError(result.error || 'Failed to delete rule (preset rules cannot be deleted)', { requestId });
    }
    addLog('info', `已刪除自訂規範 ID：${id}`, { requestId });
    broadcastEvent('rules', { action: 'delete', id });
    return { success: true };
  }
}

module.exports = new RulesService();
