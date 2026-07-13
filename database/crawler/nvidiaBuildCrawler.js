const { fetchTextWithTimeout } = require('./fetchHelpers');

const NVIDIA_BUILD_FREE_ENDPOINT_URL = 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview';

function decodeHtmlEntities(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/');
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractExpectedFreeEndpointCount(html) {
  const text = stripHtml(html);
  const filtersCount = text.match(/Filters\s*\(?\s*1\s*\)?\s*(\d+)\s*models/i);
  if (filtersCount) return Number(filtersCount[1]);

  const freeEndpointCount = text.match(/Free\s+Endpoint\s+(\d+)/i);
  if (freeEndpointCount) return Number(freeEndpointCount[1]);

  return null;
}

function normalizeBuildModelId(provider, slug) {
  const cleanedProvider = decodeURIComponent(String(provider || '').trim()).replace(/^\/+|\/+$/g, '');
  const cleanedSlug = decodeURIComponent(String(slug || '').trim()).replace(/^\/+|\/+$/g, '');
  if (!cleanedProvider || !cleanedSlug) return null;

  const blockedFirstSegments = new Set([
    'api', '_next', 'assets', 'docs', 'explore', 'models', 'skills', 'blueprints',
    'terms', 'privacy', 'contact', 'login', 'search', 'favicon.ico'
  ]);
  if (blockedFirstSegments.has(cleanedProvider.toLowerCase())) return null;
  if (cleanedSlug.includes('.') && !cleanedSlug.includes('-')) return null;

  return `${cleanedProvider}/${cleanedSlug}`;
}

function extractBuildFreeEndpointModelsFromHtml(html) {
  const normalizedHtml = decodeHtmlEntities(html);
  const models = new Map();

  const addModel = (modelId, name = null, created = 0) => {
    if (!modelId || typeof modelId !== 'string') return;
    const cleanedModelId = modelId.trim().replace(/^\/+|\/+$/g, '');
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(cleanedModelId)) return;
    if (!models.has(cleanedModelId)) {
      models.set(cleanedModelId, {
        id: cleanedModelId,
        name: name || cleanedModelId.split('/').pop(),
        created: Number.isFinite(Number(created)) ? Number(created) : 0
      });
    }
  };

  // 1. 從模型卡片連結擷取完整路徑，例如 /minimaxai/minimax-m3
  const hrefRegex = /href\s*=\s*["'](?:https:\/\/build\.nvidia\.com)?\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)(?:[?#][^"']*)?["']/g;
  let hrefMatch;
  while ((hrefMatch = hrefRegex.exec(normalizedHtml)) !== null) {
    const modelId = normalizeBuildModelId(hrefMatch[1], hrefMatch[2]);
    addModel(modelId);
  }

  // 2. 從 Next/JSON 片段或範例程式碼擷取 model 欄位
  const jsonModelRegex = /["']model["']\s*:\s*["']([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)["']/g;
  let jsonMatch;
  while ((jsonMatch = jsonModelRegex.exec(normalizedHtml)) !== null) {
    addModel(jsonMatch[1]);
  }

  // 3. 從一般文字中的 build.nvidia.com/provider/model URL 擷取
  const absoluteUrlRegex = /https:\/\/build\.nvidia\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g;
  let absoluteMatch;
  while ((absoluteMatch = absoluteUrlRegex.exec(normalizedHtml)) !== null) {
    const modelId = normalizeBuildModelId(absoluteMatch[1], absoluteMatch[2]);
    addModel(modelId);
  }

  return Array.from(models.values());
}

function buildNvidiaCatalogCandidateUrls(pageNumber) {
  const encodedFilter = 'filters=nimType%3Anim_type_preview';
  const base = `https://build.nvidia.com/models?${encodedFilter}`;

  if (pageNumber === 1) {
    return [
      `${base}&itemsPerPage=100`,
      `${base}&pageSize=100`,
      `${base}&limit=100`,
      base,
      `${base}&page=1`,
      `${base}&pageNumber=1`,
      `${base}&p=1`
    ];
  }

  const offset = (pageNumber - 1) * 24;
  return [
    `${base}&page=${pageNumber}`,
    `${base}&pageNumber=${pageNumber}`,
    `${base}&p=${pageNumber}`,
    `${base}&page=${pageNumber}&itemsPerPage=24`,
    `${base}&pageNumber=${pageNumber}&itemsPerPage=24`,
    `${base}&limit=24&offset=${offset}`,
    `${base}&offset=${offset}`
  ];
}

async function fetchNvidiaBuildFreeEndpointCatalog() {
  const collected = new Map();
  const visitedSignatures = new Set();
  let expectedCount = null;
  let lastError = null;
  const MAX_PAGES = 5;
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  let successfulUrlPattern = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let bestCandidate = null;
    let candidateUrls;

    if (page === 1 || !successfulUrlPattern) {
      candidateUrls = buildNvidiaCatalogCandidateUrls(page);
    } else {
      candidateUrls = [successfulUrlPattern.replace(/page=\d+|pageNumber=\d+|p=\d+/g, (match) => {
        const paramName = match.split('=')[0];
        return `${paramName}=${page}`;
      })];
    }

    for (const url of candidateUrls) {
      try {
        const html = await fetchTextWithTimeout(url);
        const parsedModels = extractBuildFreeEndpointModelsFromHtml(html);
        const pageExpectedCount = extractExpectedFreeEndpointCount(html);
        if (pageExpectedCount) expectedCount = pageExpectedCount;

        const signature = parsedModels.map(m => m.id).sort().join('|');
        const newModels = parsedModels.filter(m => !collected.has(m.id));

        if (!bestCandidate || newModels.length > bestCandidate.newModels.length) {
          bestCandidate = { url, parsedModels, newModels, signature };
        }

        if (expectedCount && parsedModels.length >= expectedCount) {
          bestCandidate = { url, parsedModels, newModels: parsedModels.filter(m => !collected.has(m.id)), signature };
          break;
        }
      } catch (err) {
        lastError = err;
      }

      if (page > 1 && successfulUrlPattern) break;

      if (candidateUrls.indexOf(url) < candidateUrls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!bestCandidate || bestCandidate.parsedModels.length === 0) {
      consecutiveFailures += 1;
      if (page === 1 && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw lastError || new Error('Unable to parse NVIDIA Build Free Endpoint catalog after multiple attempts.');
      }
      if (page === 1) {
        continue;
      }
      break;
    }

    consecutiveFailures = 0;

    if (!successfulUrlPattern && page === 1) {
      successfulUrlPattern = bestCandidate.url;
    }

    if (visitedSignatures.has(bestCandidate.signature) && bestCandidate.newModels.length === 0) {
      break;
    }
    visitedSignatures.add(bestCandidate.signature);

    bestCandidate.parsedModels.forEach((model) => {
      if (!collected.has(model.id)) collected.set(model.id, model);
    });

    if (expectedCount && collected.size >= expectedCount) break;
    if (bestCandidate.newModels.length === 0 && page > 1) break;

    if (page < MAX_PAGES) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (collected.size === 0) {
    throw lastError || new Error('No Free Endpoint models found from NVIDIA Build catalog.');
  }

  return {
    models: Array.from(collected.values()).sort((a, b) => a.id.localeCompare(b.id)),
    expectedCount,
    source: NVIDIA_BUILD_FREE_ENDPOINT_URL
  };
}

module.exports = {
  fetchNvidiaBuildFreeEndpointCatalog
};
