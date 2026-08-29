const { modelsConfig, apiKeys, settings } = require('../../database');
const { addLog } = require('../logs/logger');
const { broadcastEvent } = require('../utils/broadcast');
const { clearAllModelCooldowns } = require('../cooldown/modelCooldown');
const { ValidationError, UpstreamError } = require('../errors/GatewayError');

class ModelService {
  getModels(groupId = null) {
    return modelsConfig.getAll(groupId);
  }

  getGroups() {
    return modelsConfig.getGroups();
  }

  savePriorityList(models, groupId = null, requestId = null) {
    if (!models || !Array.isArray(models)) {
      throw new ValidationError('Models list is required and must be an array', { requestId });
    }
    const result = modelsConfig.savePriorityList(models, groupId);
    addLog('info', `已更新第 ${result.groupId} 組模型順位：${models.join(' -> ')}`, { requestId });
    broadcastEvent('models', { action: 'update-priority', groupId: result.groupId });
    return result;
  }

  setActiveGroup(groupId, requestId = null) {
    if (groupId === undefined || groupId === null) {
      throw new ValidationError('Group ID is required', { requestId });
    }
    const result = modelsConfig.setActiveGroup(groupId);
    addLog('info', `已切換目前使用的模型順位組別為第 ${result.activeGroup} 組。`, { requestId });
    broadcastEvent('models', { action: 'set-active-group', activeGroup: result.activeGroup });
    return result;
  }

  getAvailable() {
    return {
      models: modelsConfig.getAvailable(),
      lastSyncTime: modelsConfig.getLastSyncTime(),
      lastSyncSource: modelsConfig.getLastSyncSource(),
      expectedCount: modelsConfig.getLastSyncExpectedCount(),
      parsedCount: modelsConfig.getLastSyncParsedCount(),
      savedCount: modelsConfig.getLastSyncSavedCount()
    };
  }

  async syncFromNvidia(requestId = null) {
    const activeKeys = apiKeys.getActiveKeys();
    const fallbackKey = activeKeys.length > 0 ? activeKeys[0].key_value : null;
    const currentSettings = settings.get();
    const rawBaseUrl = currentSettings.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const targetBaseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
    const isCustomUrl = !targetBaseUrl.includes('integrate.api.nvidia.com') && !targetBaseUrl.includes('build.nvidia.com');

    if (isCustomUrl) {
      addLog('info', `開始從自訂端點同步模型清單：${targetBaseUrl}/models`, { requestId });
    } else {
      addLog('info', '開始從 NVIDIA Build 目錄同步 Free Endpoint 模型清單。', { requestId });
    }

    const result = await modelsConfig.syncFromNvidia(fallbackKey);
    if (result.success) {
      const expectedText = result.expectedCount ? ` / 標示 ${result.expectedCount} 個` : '';
      addLog('success', `模型清單同步完成：解析 ${result.parsedCount} 個，入庫 ${result.savedCount} 個${expectedText}。來源：${result.source || targetBaseUrl}`, { requestId });
      broadcastEvent('models', { action: 'sync-complete' });
      return {
        success: true,
        count: result.savedCount,
        parsedCount: result.parsedCount,
        savedCount: result.savedCount,
        expectedCount: result.expectedCount || null,
        source: result.source || null
      };
    } else {
      addLog('error', `同步模型失敗：${result.error}`, { requestId });
      throw new UpstreamError(result.error || 'Failed to sync models', { requestId });
    }
  }

  resetCooldowns(requestId = null) {
    const cleared = clearAllModelCooldowns();
    if (cleared > 0) {
      addLog('info', `已手動清除 ${cleared} 個模型的暫時跳過冷卻狀態。`, { requestId });
    }
    return { success: true, clearedCooldowns: cleared };
  }
}

module.exports = new ModelService();
