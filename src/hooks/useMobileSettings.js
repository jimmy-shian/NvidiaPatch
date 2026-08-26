import { useState, useEffect, useCallback } from 'react';
import { SecureStorage } from '../core/security/secureStorage';
import { LocalDB } from '../core/storage/localDatabase';
import { ContextManager } from '../core/context/contextManager';
import { SkillManager } from '../core/skills/skillManager';
import { MCPManager } from '../core/mcp/MCPManager';
import { createProvider, PROVIDER_TYPES } from '../core/providers';
import { CURATED_NVIDIA_MODELS, DEFAULT_NVIDIA_MODEL } from '../core/providers/NvidiaNimProvider';

const ACTIVE_PROVIDER_KEY = 'active_provider_id';
const ACTIVE_MODEL_KEY = 'active_model_id';

export function useMobileSettings() {
  const [currentProviderId, setCurrentProviderId] = useState('nvidia');
  const [currentModelId, setCurrentModelId] = useState(DEFAULT_NVIDIA_MODEL);
  const [providerConfigs, setProviderConfigs] = useState({});
  const [availableModels, setAvailableModels] = useState(CURATED_NVIDIA_MODELS);
  const [contextSettings, setContextSettings] = useState({});
  const [skills, setSkills] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Load all configurations on initial launch
  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Active provider & model
      const savedProvider = await LocalDB.getContextSetting(ACTIVE_PROVIDER_KEY, 'nvidia');
      const savedModel = await LocalDB.getContextSetting(ACTIVE_MODEL_KEY, DEFAULT_NVIDIA_MODEL);
      setCurrentProviderId(savedProvider);
      setCurrentModelId(savedModel);

      // 2. Provider configs & encrypted keys
      const configs = {};
      for (const p of PROVIDER_TYPES) {
        const storedKey = await SecureStorage.getItem(`api_key_${p.id}`);
        const storedConfig = (await LocalDB.getProviderConfigs()).find(c => c.id === p.id) || {};
        configs[p.id] = {
          id: p.id,
          name: p.name,
          baseUrl: storedConfig.baseUrl || p.defaultEndpoint,
          apiKey: storedKey || '',
          defaultModel: storedConfig.defaultModel || (p.id === 'nvidia' ? DEFAULT_NVIDIA_MODEL : '')
        };
      }
      setProviderConfigs(configs);

      // 3. Populate models from cache or provider
      const cachedModels = await LocalDB.getContextSetting(`cached_models_${savedProvider}`, null);
      if (Array.isArray(cachedModels) && cachedModels.length > 0) {
        setAvailableModels(cachedModels);
      } else {
        const activeProv = createProvider(savedProvider, configs[savedProvider] || {});
        const loadedModels = await activeProv.listModels();
        if (loadedModels && loadedModels.length > 0) {
          setAvailableModels(loadedModels);
          await LocalDB.saveContextSetting(`cached_models_${savedProvider}`, loadedModels);
        } else {
          setAvailableModels(savedProvider === 'nvidia' ? CURATED_NVIDIA_MODELS : []);
        }
      }

      // 4. Personal Context
      const ctx = await ContextManager.getContext();
      setContextSettings(ctx);

      // 5. Skills
      const allSkills = await SkillManager.getAllSkills();
      setSkills(allSkills);

      // 6. MCP Servers
      const loadedMcp = await MCPManager.getServers();
      setMcpServers(loadedMcp);
    } catch (err) {
      console.error('[useMobileSettings loadAll error]:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Switch active provider
  const changeProvider = useCallback(async (providerId) => {
    setCurrentProviderId(providerId);
    await LocalDB.saveContextSetting(ACTIVE_PROVIDER_KEY, providerId);

    const cfg = providerConfigs[providerId] || {};

    // 1. Try cached models first
    const cached = await LocalDB.getContextSetting(`cached_models_${providerId}`, null);
    if (Array.isArray(cached) && cached.length > 0) {
      setAvailableModels(cached);
      const chosenModel = cfg.defaultModel || cached[0].id;
      setCurrentModelId(chosenModel);
      await LocalDB.saveContextSetting(ACTIVE_MODEL_KEY, chosenModel);
      return;
    }

    // 2. Fetch fresh models
    const prov = createProvider(providerId, cfg);
    const models = await prov.listModels();

    if (models && models.length > 0) {
      setAvailableModels(models);
      await LocalDB.saveContextSetting(`cached_models_${providerId}`, models);
      const chosenModel = cfg.defaultModel || models[0].id;
      setCurrentModelId(chosenModel);
      await LocalDB.saveContextSetting(ACTIVE_MODEL_KEY, chosenModel);
    } else {
      setAvailableModels(providerId === 'nvidia' ? CURATED_NVIDIA_MODELS : []);
      if (cfg.defaultModel) {
        setCurrentModelId(cfg.defaultModel);
      }
    }
  }, [providerConfigs]);

  // Update Provider Config & Secure API Key
  const updateProviderConfig = useCallback(async (providerId, updates) => {
    setProviderConfigs(prev => ({
      ...prev,
      [providerId]: { ...prev[providerId], ...updates }
    }));

    // If apiKey is in updates, store in SecureStorage
    if ('apiKey' in updates) {
      await SecureStorage.setItem(`api_key_${providerId}`, updates.apiKey);
    }

    // If defaultModel is updated and this is active provider, update active model
    if ('defaultModel' in updates && updates.defaultModel) {
      if (providerId === currentProviderId) {
        setCurrentModelId(updates.defaultModel);
        await LocalDB.saveContextSetting(ACTIVE_MODEL_KEY, updates.defaultModel);
      }
    }

    // Save non-sensitive metadata to LocalDB
    const { apiKey, ...safeMeta } = updates;
    await LocalDB.saveProviderConfig({
      id: providerId,
      ...safeMeta
    });
  }, [currentProviderId]);

  // Set active model & provider
  const selectModel = useCallback(async (providerId, modelId) => {
    setCurrentProviderId(providerId);
    setCurrentModelId(modelId);
    await LocalDB.saveContextSetting(ACTIVE_PROVIDER_KEY, providerId);
    await LocalDB.saveContextSetting(ACTIVE_MODEL_KEY, modelId);
  }, []);

  // Test provider connection
  const testConnection = useCallback(async (providerId) => {
    const config = providerConfigs[providerId];
    if (!config) return { success: false, message: 'Provider 未設定' };
    const provider = createProvider(providerId, config);
    return provider.testConnection();
  }, [providerConfigs]);

  // Sync models from provider (matching master branch)
  const syncModels = useCallback(async (providerId = currentProviderId) => {
    setIsSyncing(true);
    try {
      const config = providerConfigs[providerId] || {};
      const provider = createProvider(providerId, config);
      const models = await provider.listModels();
      if (Array.isArray(models) && models.length > 0) {
        setAvailableModels(models);
        await LocalDB.saveContextSetting(`cached_models_${providerId}`, models);
        return { success: true, count: models.length, models };
      }
      return { success: false, message: '未能從伺服器取得模型清單，請檢查端點或網路連線。' };
    } catch (err) {
      return { success: false, message: err.message || '同步失敗' };
    } finally {
      setIsSyncing(false);
    }
  }, [currentProviderId, providerConfigs]);

  // Update Personal Context
  const updateContext = useCallback(async (newContext) => {
    setContextSettings(newContext);
    await ContextManager.saveContext(newContext);
  }, []);

  // Skill management
  const importSkill = useCallback(async (markdownText, fallbackId) => {
    const saved = await SkillManager.importSkillFromMarkdown(markdownText, fallbackId);
    const updatedList = await SkillManager.getAllSkills();
    setSkills(updatedList);
    return saved;
  }, []);

  const saveSkill = useCallback(async (skill) => {
    await SkillManager.saveSkill(skill);
    const updatedList = await SkillManager.getAllSkills();
    setSkills(updatedList);
  }, []);

  const deleteSkill = useCallback(async (skillId) => {
    await SkillManager.deleteSkill(skillId);
    const updatedList = await SkillManager.getAllSkills();
    setSkills(updatedList);
  }, []);

  // MCP Server management
  const addMcpServer = useCallback(async (serverParams) => {
    const res = await MCPManager.connectServer({
      ...serverParams,
      isManualUserAction: true
    });
    const updated = await MCPManager.getServers();
    setMcpServers(updated);
    return res;
  }, []);

  const toggleMcpServer = useCallback(async (id, enabled) => {
    await MCPManager.toggleServer(id, enabled);
    const updated = await MCPManager.getServers();
    setMcpServers(updated);
  }, []);

  const deleteMcpServer = useCallback(async (id) => {
    await MCPManager.deleteServer(id);
    const updated = await MCPManager.getServers();
    setMcpServers(updated);
  }, []);

  const syncMcpServer = useCallback(async (id) => {
    const res = await MCPManager.syncServerTools(id);
    const updated = await MCPManager.getServers();
    setMcpServers(updated);
    return res;
  }, []);

  const testMcpConnection = useCallback(async (params) => {
    return MCPManager.testConnection(params);
  }, []);

  return {
    isLoading,
    isSyncing,
    currentProviderId,
    currentModelId,
    providerConfigs,
    availableModels,
    contextSettings,
    skills,
    mcpServers,
    changeProvider,
    selectModel,
    updateProviderConfig,
    testConnection,
    syncModels,
    updateContext,
    importSkill,
    saveSkill,
    deleteSkill,
    addMcpServer,
    toggleMcpServer,
    deleteMcpServer,
    syncMcpServer,
    testMcpConnection
  };
}
