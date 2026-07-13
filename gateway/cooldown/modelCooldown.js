const { settings } = require('../../database');
const { addLog } = require('../logs/logger');

const modelFailureCooldowns = new Map();
let gatewayRequestSequence = 0;

function isModelInFailureCooldown(modelId) {
  const until = modelFailureCooldowns.get(modelId);
  if (!until) return false;
  if (Date.now() >= until) {
    modelFailureCooldowns.delete(modelId);
    return false;
  }
  return true;
}

function markModelFailureCooldown(modelId, reason = '模型層級失敗') {
  const cooldownMs = (process.env.NODE_ENV === 'test') ? 100 : Number(settings.get().MODEL_FAILURE_COOLDOWN_MS || 60000);
  modelFailureCooldowns.set(modelId, Date.now() + cooldownMs);
  addLog('warning', `模型「${modelId}」已進入 ${Math.round(cooldownMs / 1000)} 秒暫時跳過狀態；原因：${reason}`);
}

function clearAllModelCooldowns() {
  const size = modelFailureCooldowns.size;
  modelFailureCooldowns.clear();
  return size;
}

function getNextRequestSequence() {
  gatewayRequestSequence += 1;
  return gatewayRequestSequence;
}

module.exports = {
  isModelInFailureCooldown,
  markModelFailureCooldown,
  clearAllModelCooldowns,
  getNextRequestSequence
};
