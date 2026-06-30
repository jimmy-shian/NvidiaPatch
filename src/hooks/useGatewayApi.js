import { useCallback } from 'react';

const FETCH_TIMEOUT_MS = 30000;

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => {
    clearTimeout(timeoutId);
  });
}

export default function useGatewayApi(gatewayUrl, adminToken) {
  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
  }), [adminToken]);

  const apiFetch = useCallback(async (path, options = {}) => {
    const res = await fetchWithTimeout(`${gatewayUrl}${path}`, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      throw new Error('AUTH_REQUIRED');
    }
    return res;
  }, [gatewayUrl, authHeaders]);

  const fetchKeys = useCallback(async () => {
    const res = await apiFetch('/api/keys');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch keys: ${res.status}`);
  }, [apiFetch]);

  const addKey = useCallback(async (key) => {
    const res = await apiFetch('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ key })
    });
    if (res.ok) return await res.json();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Add key failed: ${res.status}`);
  }, [apiFetch]);

  const deleteKey = useCallback(async (id) => {
    const res = await apiFetch(`/api/keys/${id}`, { method: 'DELETE' });
    if (res.ok) return true;
    throw new Error(`Delete key failed: ${res.status}`);
  }, [apiFetch]);

  const testKeys = useCallback(async () => {
    const res = await apiFetch('/api/keys/test', { method: 'POST' });
    if (res.ok) return await res.json();
    throw new Error(`Test keys failed: ${res.status}`);
  }, [apiFetch]);

  const fetchModels = useCallback(async (groupId) => {
    const query = groupId ? `?groupId=${groupId}` : '';
    const res = await apiFetch(`/api/models${query}`);
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch models: ${res.status}`);
  }, [apiFetch]);

  const saveModelPriorities = useCallback(async (modelIds, groupId) => {
    const res = await apiFetch('/api/models', {
      method: 'POST',
      body: JSON.stringify({ models: modelIds, groupId })
    });
    if (res.ok) return await res.json();
    throw new Error(`Save priorities failed: ${res.status}`);
  }, [apiFetch]);

  const fetchModelGroups = useCallback(async () => {
    const res = await apiFetch('/api/models/groups');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch model groups: ${res.status}`);
  }, [apiFetch]);

  const setActiveModelGroup = useCallback(async (groupId) => {
    const res = await apiFetch('/api/models/groups/active', {
      method: 'POST',
      body: JSON.stringify({ groupId })
    });
    if (res.ok) return await res.json();
    throw new Error(`Set active group failed: ${res.status}`);
  }, [apiFetch]);

  const fetchAvailableModels = useCallback(async () => {
    const res = await apiFetch('/api/models/available');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch available models: ${res.status}`);
  }, [apiFetch]);

  const syncModels = useCallback(async () => {
    const res = await apiFetch('/api/models/sync', { method: 'POST' }, 60000);
    if (res.ok) return await res.json();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sync failed: ${res.status}`);
  }, [apiFetch]);

  const fetchRules = useCallback(async () => {
    const res = await apiFetch('/api/rules');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch rules: ${res.status}`);
  }, [apiFetch]);

  const addRule = useCallback(async (title, content) => {
    const res = await apiFetch('/api/rules', {
      method: 'POST',
      body: JSON.stringify({ title, content })
    });
    if (res.ok) return await res.json();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Add rule failed: ${res.status}`);
  }, [apiFetch]);

  const updateRule = useCallback(async (id, title, content) => {
    const res = await apiFetch(`/api/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content })
    });
    if (res.ok) return await res.json();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Update rule failed: ${res.status}`);
  }, [apiFetch]);

  const deleteRule = useCallback(async (id) => {
    const res = await apiFetch(`/api/rules/${id}`, { method: 'DELETE' });
    if (res.ok) return true;
    throw new Error(`Delete rule failed: ${res.status}`);
  }, [apiFetch]);

  const fetchSettings = useCallback(async () => {
    const res = await apiFetch('/api/settings');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch settings: ${res.status}`);
  }, [apiFetch]);

  const saveSettings = useCallback(async (settings) => {
    const res = await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
    if (res.ok) return await res.json();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.details?.join('; ') || `Save settings failed: ${res.status}`);
  }, [apiFetch]);

  const fetchTokenUsage = useCallback(async () => {
    const res = await apiFetch('/api/token-usage');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch token usage: ${res.status}`);
  }, [apiFetch]);

  const clearTokenUsage = useCallback(async () => {
    const res = await apiFetch('/api/token-usage/clear', { method: 'POST' });
    if (res.ok) return true;
    throw new Error(`Clear token usage failed: ${res.status}`);
  }, [apiFetch]);

  const fetchLogs = useCallback(async () => {
    const res = await apiFetch('/api/logs');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch logs: ${res.status}`);
  }, [apiFetch]);

  const fetchStats = useCallback(async () => {
    const res = await apiFetch('/api/stats');
    if (res.ok) return await res.json();
    throw new Error(`Failed to fetch stats: ${res.status}`);
  }, [apiFetch]);

  const checkHealth = useCallback(async () => {
    const res = await fetchWithTimeout(`${gatewayUrl}/api/health`);
    if (res.ok) return await res.json();
    return null;
  }, [gatewayUrl]);

  const resetCooldowns = useCallback(async () => {
    const res = await apiFetch('/api/gateway/reset-cooldowns', { method: 'POST' });
    if (res.ok) return await res.json();
    throw new Error(`Reset cooldowns failed: ${res.status}`);
  }, [apiFetch]);

  const login = useCallback(async (token) => {
    const res = await fetchWithTimeout(`${gatewayUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    return res.ok;
  }, [gatewayUrl]);

  return {
    apiFetch, fetchKeys, addKey, deleteKey, testKeys,
    fetchModels, saveModelPriorities, fetchModelGroups, setActiveModelGroup,
    fetchAvailableModels, syncModels,
    fetchRules, addRule, updateRule, deleteRule,
    fetchSettings, saveSettings,
    fetchTokenUsage, clearTokenUsage,
    fetchLogs, fetchStats,
    checkHealth, resetCooldowns, login
  };
}
