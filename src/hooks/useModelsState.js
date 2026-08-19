import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export default function useModelsState(api, fetchData, setSelectedTestModel) {
  const { t } = useTranslation();
  const [models, setModels] = useState([]);
  const [activeModelGroup, setActiveModelGroup] = useState(1);
  const [modelGroups, setModelGroups] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [isSyncingModels, setIsSyncingModels] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [lastSyncSource, setLastSyncSource] = useState(null);
  const [expectedModelCount, setExpectedModelCount] = useState(null);
  const [lastParsedModelCount, setLastParsedModelCount] = useState(null);
  const [lastSavedModelCount, setLastSavedModelCount] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);
  const syncNoticeTimerRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  useEffect(() => {
    return () => {
      if (syncNoticeTimerRef.current) clearTimeout(syncNoticeTimerRef.current);
    };
  }, []);

  const showSyncNotice = useCallback((type, message) => {
    if (syncNoticeTimerRef.current) clearTimeout(syncNoticeTimerRef.current);
    setSyncNotice({ type, message, createdAt: Date.now() });
    syncNoticeTimerRef.current = setTimeout(() => {
      setSyncNotice(null);
      syncNoticeTimerRef.current = null;
    }, type === 'error' ? 10000 : 7000);
  }, []);

  const formatModelSyncSummary = useCallback(({ parsedCount, savedCount, expectedCount }) => {
    const parts = [];
    if (Number.isFinite(Number(parsedCount))) parts.push(`${t('models.parsed')}: ${Number(parsedCount)}`);
    if (Number.isFinite(Number(savedCount))) parts.push(`${t('models.saved')}: ${Number(savedCount)}`);
    if (Number.isFinite(Number(expectedCount))) parts.push(`${t('models.expected')}: ${Number(expectedCount)}`);
    return parts.join(' | ') || t('models.syncComplete');
  }, [t]);

  const handleSyncModels = useCallback(async () => {
    setIsSyncingModels(true);
    showSyncNotice('info', t('models.syncing'));
    try {
      const data = await api.syncModels();
      setLastParsedModelCount(data.parsedCount ?? null);
      setLastSavedModelCount(data.savedCount ?? data.count ?? null);
      setExpectedModelCount(data.expectedCount || null);
      setLastSyncSource(data.source || null);
      showSyncNotice('success', `Sync OK: ${formatModelSyncSummary({
        parsedCount: data.parsedCount,
        savedCount: data.savedCount ?? data.count,
        expectedCount: data.expectedCount,
        source: data.source
      })}`);
      if (fetchData) fetchData();
    } catch (err) {
      showSyncNotice('error', `Sync failed: ${err.message}`);
    } finally {
      setIsSyncingModels(false);
    }
  }, [api, showSyncNotice, formatModelSyncSummary, fetchData, t]);

  const saveModelPriorities = useCallback(async (modelIds, groupId = activeModelGroup) => {
    try {
      await api.saveModelPriorities(modelIds, groupId);
      if (fetchData) fetchData();
    } catch (err) {
      console.error('Save model priorities failed:', err);
      throw err;
    }
  }, [api, activeModelGroup, fetchData]);

  const buildModelsFromOrder = useCallback((modelIds) => {
    return modelIds.map((modelId, index) => {
      const existing = models.find(m => m.model_id === modelId);
      return {
        ...(existing || {}),
        id: existing?.id || modelId,
        model_id: modelId,
        priority: index + 1
      };
    });
  }, [models]);

  const playgroundModels = useMemo(() => {
    const order = models.map(m => m.model_id);
    return [...availableModels].sort((a, b) => {
      const aIdx = order.indexOf(a.id);
      const bIdx = order.indexOf(b.id);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }, [availableModels, models]);

  const handleSwitchModelGroup = useCallback(async (groupId) => {
    if (groupId === activeModelGroup) return;
    setActiveModelGroup(groupId);
    try {
      await api.setActiveModelGroup(groupId);
      const [modelsData, groupsData] = await Promise.all([
        api.fetchModels().catch(err => { console.error('fetchModels err:', err); return null; }),
        api.fetchModelGroups().catch(err => { console.error('fetchModelGroups err:', err); return null; })
      ]);
      if (modelsData) setModels(modelsData);
      if (groupsData) setModelGroups(groupsData.groups || []);
    } catch (err) {
      alert(`Switch group failed: ${err.message}`);
      if (fetchData) fetchData();
    }
  }, [activeModelGroup, api, fetchData]);

  const handleMovePriority = useCallback(async (index, direction) => {
    const newModels = [...models];
    if (direction === 'up' && index > 0) {
      const temp = newModels[index];
      newModels[index] = newModels[index - 1];
      newModels[index - 1] = temp;
    } else if (direction === 'down' && index < newModels.length - 1) {
      const temp = newModels[index];
      newModels[index] = newModels[index + 1];
      newModels[index + 1] = temp;
    }
    const order = newModels.map(m => m.model_id);
    setModels(buildModelsFromOrder(order));
    try {
      await saveModelPriorities(order);
    } catch (err) {
      if (fetchData) fetchData();
    }
  }, [models, buildModelsFromOrder, saveModelPriorities, fetchData]);

  const handleRemoveModelFromPriority = useCallback(async (modelId) => {
    const order = models.map(m => m.model_id).filter(id => id !== modelId);
    setModels(buildModelsFromOrder(order));
    try {
      await saveModelPriorities(order);
    } catch (err) {
      if (fetchData) fetchData();
    }
  }, [models, buildModelsFromOrder, saveModelPriorities, fetchData]);

  const handleAddModelToPriority = useCallback(async (modelId) => {
    if (models.some(m => m.model_id === modelId)) return;
    const order = [...models.map(m => m.model_id), modelId];
    setModels(buildModelsFromOrder(order));
    try {
      await saveModelPriorities(order);
    } catch (err) {
      if (fetchData) fetchData();
    }
  }, [models, buildModelsFromOrder, saveModelPriorities, fetchData]);

  return {
    models,
    setModels,
    activeModelGroup,
    setActiveModelGroup,
    modelGroups,
    setModelGroups,
    availableModels,
    setAvailableModels,
    isSyncingModels,
    setIsSyncingModels,
    lastSyncTime,
    setLastSyncTime,
    lastSyncSource,
    setLastSyncSource,
    expectedModelCount,
    setExpectedModelCount,
    lastParsedModelCount,
    setLastParsedModelCount,
    lastSavedModelCount,
    setLastSavedModelCount,
    syncNotice,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    playgroundModels,
    handleSyncModels,
    handleSwitchModelGroup,
    handleMovePriority,
    handleRemoveModelFromPriority,
    handleAddModelToPriority,
    saveModelPriorities,
    buildModelsFromOrder,
    showSyncNotice
  };
}
