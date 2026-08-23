/**
 * NVIDIA NIM Model Catalog & Crawler
 * Implements the exact parsing, filtering, normalization, deduplication, and sorting pipeline
 * matching master branch (build.nvidia.com preview crawler, integrate models API, and NGC featured fallback).
 */
import { HttpClient } from '../network/httpClient';
import { sanitizeLog } from '../security/secureStorage';

export const NVIDIA_BUILD_FREE_ENDPOINT_URL = 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview&pageSize=100';
export const NVIDIA_INTEGRATE_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';
export const NVIDIA_FEATURED_MODELS_URL = 'https://assets.ngc.nvidia.com/products/api-catalog/featured-models.json';

const BLOCKED_FIRST_SEGMENTS = new Set([
  'api', '_next', 'assets', 'docs', 'explore', 'models', 'skills', 'blueprints',
  'terms', 'privacy', 'contact', 'login', 'search', 'favicon.ico', 'akam', 'challenge', 'waf'
]);

export function decodeHtmlEntities(value) {
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

export function normalizeBuildModelId(provider, slug) {
  const cleanedProvider = decodeURIComponent(String(provider || '').trim()).replace(/^\/+|\/+$/g, '');
  const cleanedSlug = decodeURIComponent(String(slug || '').trim()).replace(/^\/+|\/+$/g, '');
  if (!cleanedProvider || !cleanedSlug) return null;

  if (BLOCKED_FIRST_SEGMENTS.has(cleanedProvider.toLowerCase())) return null;
  if (cleanedSlug.includes('.') && !cleanedSlug.includes('-')) return null;

  return `${cleanedProvider}/${cleanedSlug}`;
}

export function extractBuildFreeEndpointModelsFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  if (html.includes('AwsWafIntegration') || html.includes('challenge-container') || html.includes('awswaf.com')) {
    return [];
  }

  const normalizedHtml = decodeHtmlEntities(html);
  const models = new Map();

  const addModel = (modelId) => {
    if (!modelId || typeof modelId !== 'string' || models.has(modelId)) return;
    const parts = modelId.split('/');
    if (parts.length !== 2) return;
    const [provider, slug] = parts;
    if (BLOCKED_FIRST_SEGMENTS.has(provider.toLowerCase())) return;

    const formattedName = slug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    models.set(modelId, {
      id: modelId,
      name: formattedName,
      vendor: provider.toUpperCase(),
      created: 0
    });
  };

  // 1. href regex
  const hrefRegex = /href\s*=\s*["'](?:https:\/\/build\.nvidia\.com)?\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)(?:[?#][^"']*)?["']/g;
  let hrefMatch;
  while ((hrefMatch = hrefRegex.exec(normalizedHtml)) !== null) {
    const modelId = normalizeBuildModelId(hrefMatch[1], hrefMatch[2]);
    if (modelId) addModel(modelId);
  }

  // 2. json model property regex
  const jsonModelRegex = /["']model["']\s*:\s*["']([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)["']/g;
  let jsonMatch;
  while ((jsonMatch = jsonModelRegex.exec(normalizedHtml)) !== null) {
    addModel(jsonMatch[1]);
  }

  // 3. absolute url regex
  const absoluteUrlRegex = /https:\/\/build\.nvidia\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g;
  let absoluteMatch;
  while ((absoluteMatch = absoluteUrlRegex.exec(normalizedHtml)) !== null) {
    const modelId = normalizeBuildModelId(absoluteMatch[1], absoluteMatch[2]);
    if (modelId) addModel(modelId);
  }

  return Array.from(models.values());
}

export function sortNvidiaModels(models = []) {
  const priorityKeywords = [
    'nemotron-120b',
    'nemotron-70b',
    'nemotron-4-340b',
    'deepseek-r1',
    'deepseek-v3',
    'llama-3.3-70b',
    'llama-3.1-405b',
    'llama-3.1-70b',
    'llama-3.1-8b',
    'qwen2.5-72b',
    'mistral-large'
  ];

  return [...models].sort((a, b) => {
    const aLower = a.id.toLowerCase();
    const bLower = b.id.toLowerCase();

    const aPriority = priorityKeywords.findIndex(k => aLower.includes(k));
    const bPriority = priorityKeywords.findIndex(k => bLower.includes(k));

    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
    if (aPriority !== -1) return -1;
    if (bPriority !== -1) return 1;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Multi-stage catalog fetcher matching master branch logic:
 * 1. build.nvidia.com Candidate URLs (Preview models catalog)
 * 2. integrate.api.nvidia.com/v1/models (Full NVIDIA NIM models list)
 * 3. assets.ngc.nvidia.com/products/api-catalog/featured-models.json (NGC Featured models fallback)
 */
export async function fetchNvidiaCatalog(apiKey = '') {
  let rawModels = [];

  // Stage 1: build.nvidia.com candidate URLs
  const candidateUrls = [
    'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview&pageSize=100',
    'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview&itemsPerPage=100',
    'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview'
  ];

  for (const url of candidateUrls) {
    try {
      const res = await HttpClient.request({
        url,
        method: 'GET',
        timeout: 8000
      });
      if (res.ok && typeof res.data === 'string') {
        const parsed = extractBuildFreeEndpointModelsFromHtml(res.data);
        if (parsed.length > 0) {
          rawModels = parsed;
          break;
        }
      }
    } catch (err) {
      console.warn(`[fetchNvidiaCatalog Stage 1 error for ${url}]:`, sanitizeLog(err.message));
    }
  }

  // Stage 2: integrate.api.nvidia.com/v1/models (Works with OR without API key)
  if (rawModels.length === 0) {
    try {
      const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
      const res = await HttpClient.request({
        url: NVIDIA_INTEGRATE_MODELS_URL,
        method: 'GET',
        headers,
        timeout: 12000
      });
      if (res.ok && Array.isArray(res.data?.data) && res.data.data.length > 0) {
        const blockedKeywords = ['embed', 'rerank', 'whisper', 'tts', 'stt', 'clip', 'vision-guard', 'riva', 'shield', 'safety-guard'];
        const seen = new Set();
        const apiModels = [];

        for (const item of res.data.data) {
          const modelId = typeof item.id === 'string' ? item.id.trim() : '';
          if (!modelId || seen.has(modelId)) continue;
          const lower = modelId.toLowerCase();
          if (blockedKeywords.some(b => lower.includes(b))) continue;

          seen.add(modelId);
          const parts = modelId.split('/');
          const vendor = parts.length > 1 ? parts[0] : 'NVIDIA';
          const slug = parts.length > 1 ? parts.slice(1).join('/') : modelId;
          const name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          apiModels.push({
            id: modelId,
            name,
            vendor: vendor.toUpperCase(),
            created: item.created || 0
          });
        }
        if (apiModels.length > 0) {
          rawModels = apiModels;
        }
      }
    } catch (err) {
      console.warn('[fetchNvidiaCatalog Stage 2 API error]:', sanitizeLog(err.message));
    }
  }

  // Stage 3: NGC featured models fallback
  if (rawModels.length === 0) {
    try {
      const res = await HttpClient.request({
        url: NVIDIA_FEATURED_MODELS_URL,
        method: 'GET',
        timeout: 10000
      });
      if (res.ok && res.data) {
        const data = res.data;
        const entries = Array.isArray(data)
          ? data
          : (Array.isArray(data['featured-models']) ? data['featured-models'] : (Array.isArray(data.data) ? data.data : []));

        const seen = new Set();
        const featuredModels = [];
        for (const entry of entries) {
          const modelId = entry.model || entry.id || entry.name;
          if (!modelId || typeof modelId !== 'string' || seen.has(modelId)) continue;
          seen.add(modelId);
          featuredModels.push({
            id: modelId,
            name: entry['model-name'] || entry.name || modelId.split('/').pop(),
            vendor: 'NVIDIA',
            created: 0
          });
        }
        if (featuredModels.length > 0) {
          rawModels = featuredModels;
        }
      }
    } catch (err) {
      console.warn('[fetchNvidiaCatalog Stage 3 Featured error]:', sanitizeLog(err.message));
    }
  }

  return sortNvidiaModels(rawModels);
}
