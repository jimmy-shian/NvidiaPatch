const { fetchTextWithTimeout } = require('./fetchHelpers');

const NVIDIA_INTEGRATE_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

async function fetchNvidiaIntegrateModelsCatalog() {
  const text = await fetchTextWithTimeout(NVIDIA_INTEGRATE_MODELS_URL, {}, 20000);
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('Invalid format or empty models array from integrate.api.nvidia.com/v1/models');
  }
  const seen = new Set();
  const models = data.data
    .map((m) => {
      const modelId = typeof m.id === 'string' ? m.id.trim() : '';
      if (!modelId || seen.has(modelId)) return null;
      seen.add(modelId);
      return {
        id: modelId,
        name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : modelId.split('/').pop(),
        created: Number.isFinite(Number(m.created)) ? Number(m.created) : 0
      };
    })
    .filter(Boolean);

  if (models.length === 0) {
    throw new Error('No valid models parsed from integrate.api.nvidia.com/v1/models');
  }

  return {
    models,
    expectedCount: data.data.length,
    source: NVIDIA_INTEGRATE_MODELS_URL
  };
}

module.exports = {
  fetchNvidiaIntegrateModelsCatalog
};
