const { fetchTextWithTimeout } = require('./fetchHelpers');

const NVIDIA_FEATURED_MODELS_URL = 'https://assets.ngc.nvidia.com/products/api-catalog/featured-models.json';

async function fetchNvidiaFeaturedModelsCatalog() {
  const text = await fetchTextWithTimeout(NVIDIA_FEATURED_MODELS_URL, {}, 20000);
  const data = JSON.parse(text);
  const entries = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
  const models = [];
  const seen = new Set();

  entries.forEach((entry) => {
    const modelId = entry.model || entry.id || entry.name;
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    models.push({
      id: modelId,
      name: entry['model-name'] || entry.name || modelId.split('/').pop(),
      created: 0
    });
  });

  return {
    models,
    expectedCount: null,
    source: NVIDIA_FEATURED_MODELS_URL
  };
}

module.exports = {
  fetchNvidiaFeaturedModelsCatalog
};
