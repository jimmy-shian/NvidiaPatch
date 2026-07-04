import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, Key, Cpu, FileText, Plus, Trash, Copy, Check,
  RotateCw, ShieldAlert, CheckCircle, AlertTriangle, ArrowUp,
  ArrowDown, RefreshCw, X, Play, CopyCheck, Power, Loader2, Edit3, Globe
} from 'lucide-react';
import packageJson from '../package.json';
import useGatewayApi from './hooks/useGatewayApi';
import useRealtimeEvents from './hooks/useRealtimeEvents';
import useNotifications from './hooks/useNotifications';
import ErrorBoundary from './components/shared/ErrorBoundary';
import MarkdownContent from './components/shared/MarkdownContent';
import RulesPanel from './components/Rules/RulesPanel';
import { translateLogMessage } from './i18n/logTranslator';

const LANGUAGE_OPTIONS = [
  { code: 'zh-TW', label: '中' },
  { code: 'en-US', label: 'EN' },
  { code: 'ja-JP', label: '日' }
];

export default function App() {
  const { t, i18n } = useTranslation();

  const getGatewayUrl = () => {
    if (window.electronAPI && window.electronAPI.getGatewayPort) {
      try {
        const port = window.electronAPI.getGatewayPort();
        return `http://localhost:${port}`;
      } catch (e) {
        console.error('Failed to get gateway port via IPC:', e);
      }
    }
    return `http://localhost:4000`;
  };
  const GATEWAY_URL = getGatewayUrl();

  const [adminToken, setAdminToken] = useState('bypass');
  const [loginInput, setLoginInput] = useState('');
  const [authError, setAuthError] = useState('');

  const api = useGatewayApi(GATEWAY_URL, adminToken);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'theme-dark');
  const [settingsData, setSettingsData] = useState({
    ROUND_DELAY_MS: 15000,
    REQUEST_TIMEOUT_MS: 120000,
    STREAM_READ_TIMEOUT_MS: 120000
  });
  const [tokenUsageData, setTokenUsageData] = useState({ stats: [], logs: [] });

  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [models, setModels] = useState([]);
  const [activeModelGroup, setActiveModelGroup] = useState(1);
  const [modelGroups, setModelGroups] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [rules, setRules] = useState([]);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleContent, setNewRuleContent] = useState('');
  const [stats, setStats] = useState({
    hourly: [],
    keysCount: 0,
    activeKeysCount: 0,
    modelsCount: 0
  });
  const [logs, setLogs] = useState([]);
  const logsContainerRef = useRef(null);
  const shouldAutoFollowLogsRef = useRef(true);
  const sseLogsBufferRef = useRef([]);
  const sseLogsTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (sseLogsTimeoutRef.current) clearTimeout(sseLogsTimeoutRef.current);
    };
  }, []);

  const [isSyncingModels, setIsSyncingModels] = useState(false);
  const [isTestingKeys, setIsTestingKeys] = useState(false);
  const [keyTestNotice, setKeyTestNotice] = useState(null);
  const keyTestNoticeTimerRef = useRef(null);
  const [copiedId, setCopiedId] = useState(null);
  const [apiError, setApiError] = useState('');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [tempSettings, setTempSettings] = useState(null);

  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [lastSyncSource, setLastSyncSource] = useState(null);
  const [expectedModelCount, setExpectedModelCount] = useState(null);
  const [lastParsedModelCount, setLastParsedModelCount] = useState(null);
  const [lastSavedModelCount, setLastSavedModelCount] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);
  const syncNoticeTimerRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const [selectedTestModel, setSelectedTestModel] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef(null);

  const [draggedModelIndex, setDraggedModelIndex] = useState(null);
  const [draggedAvailableModelId, setDraggedAvailableModelId] = useState(null);
  const [isPriorityDropActive, setIsPriorityDropActive] = useState(false);
  const [priorityDropIndex, setPriorityDropIndex] = useState(null);
  const localModelOrderRef = useRef(null);

  const [dashboardSubTab, setDashboardSubTab] = useState('overview');
  const [currentTimeMs, setCurrentTimeMs] = useState(Date.now());
  const [hoveredHourlyIndex, setHoveredHourlyIndex] = useState(null);

  const [expandedTokenLogId, setExpandedTokenLogId] = useState(null);
  const [expandedTokenLogTabs, setExpandedTokenLogTabs] = useState({});

  const [gatewayHealth, setGatewayHealth] = useState(null);
  const [isRestartingGateway, setIsRestartingGateway] = useState(false);
  const [restartNotice, setRestartNotice] = useState(null);
  const restartNoticeTimerRef = useRef(null);

  const { notifyAllKeysDown, notifyAllModelsDegraded } = useNotifications();

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (syncNoticeTimerRef.current) clearTimeout(syncNoticeTimerRef.current);
      if (keyTestNoticeTimerRef.current) clearTimeout(keyTestNoticeTimerRef.current);
      if (restartNoticeTimerRef.current) clearTimeout(restartNoticeTimerRef.current);
    };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const promises = [
        api.fetchKeys().then(data => setKeys(data)).catch(err => console.error('keys:', err)),
        api.fetchModels().then(data => setModels(data)).catch(err => console.error('models:', err)),
        api.fetchModelGroups().then(data => { setActiveModelGroup(data.activeGroup || 1); setModelGroups(data.groups || []); }).catch(err => console.error('modelGroups:', err)),
        api.fetchAvailableModels().then(data => { setAvailableModels(data.models || []); setLastSyncTime(data.lastSyncTime || null); setLastSyncSource(data.lastSyncSource || null); setExpectedModelCount(data.expectedCount || null); setLastParsedModelCount(data.parsedCount ?? null); setLastSavedModelCount(data.savedCount ?? null); if (data.models?.length > 0) setSelectedTestModel(prev => prev || data.models[0].id); }).catch(err => console.error('availModels:', err)),
        api.fetchRules().then(data => setRules(data)).catch(err => console.error('rules:', err)),
        api.fetchSettings().then(data => setSettingsData(data)).catch(err => console.error('settings:', err)),
        api.fetchTokenUsage().then(data => setTokenUsageData(data)).catch(err => console.error('tokenUsage:', err)),
        api.fetchLogs().then(data => setLogs(data)).catch(err => console.error('logs:', err)),
        api.fetchStats().then(data => setStats(data)).catch(err => console.error('stats:', err)),
      ];
      await Promise.all(promises);
      setApiError('');
    } catch (err) {
      setApiError('Unable to connect to Gateway.');
    }
  }, [api]);

  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    if (!loginInput.trim()) return;
    setAuthError('');
    try {
      const ok = await api.login(loginInput.trim());
      if (ok) {
        localStorage.setItem('gateway_admin_token', loginInput.trim());
        setAdminToken(loginInput.trim());
        setLoginInput('');
      } else {
        setAuthError(t('auth.invalidToken'));
      }
    } catch (err) {
      if (err.message === 'AUTH_REQUIRED' || err.message?.includes('401')) {
        setAuthError(t('auth.invalidToken'));
      } else {
        setAuthError(t('auth.connectionFailed'));
      }
    }
  }, [loginInput, api]);

  useEffect(() => {
    if (adminToken) {
      fetchData();
    }
  }, [adminToken, fetchData]);

  useEffect(() => {
    if (activeTab === 'keys') {
      api.fetchKeys().then(data => setKeys(data)).catch(() => {});
    }
  }, [activeTab, api]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'models' && availableModels.length === 0 && !isSyncingModels) {
      handleSyncModelsSilently();
    }
  }, [activeTab, availableModels.length]);

  useEffect(() => {
    if (dashboardSubTab !== 'logs') return;
    if (!shouldAutoFollowLogsRef.current) return;
    requestAnimationFrame(() => {
      scrollLogsToBottom('auto');
    });
  }, [logs, dashboardSubTab]);

  const checkGatewayHealth = useCallback(async () => {
    try {
      const data = await api.checkHealth();
      setGatewayHealth(data);
      return data;
    } catch (err) {
      setGatewayHealth(null);
      return null;
    }
  }, [api]);

  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onGatewayRestarted) return;
    const unsubscribe = window.electronAPI.onGatewayRestarted(() => {
      checkGatewayHealth();
      fetchData();
    });
    return unsubscribe;
  }, [checkGatewayHealth, fetchData]);

  useEffect(() => {
    if (keys.length > 0 && keys.every(k => k.status === 'inactive' || k.status === 'cooldown')) {
      notifyAllKeysDown();
    }
  }, [keys, notifyAllKeysDown]);

  const sseConnected = useRealtimeEvents(GATEWAY_URL, adminToken, {
    onLogs: (data) => {
      sseLogsBufferRef.current.push(data);
      if (!sseLogsTimeoutRef.current) {
        sseLogsTimeoutRef.current = setTimeout(() => {
          setLogs(prev => {
            const updated = [...prev, ...sseLogsBufferRef.current];
            sseLogsBufferRef.current = [];
            return updated.length > 100 ? updated.slice(-100) : updated;
          });
          sseLogsTimeoutRef.current = null;
        }, 150);
      }
    },
    onStats: (data) => { setStats(data); },
    onKeys: (data) => { if (data.action !== 'test') fetchData(); },
    onModels: () => { fetchData(); },
    onRules: () => { fetchData(); },
    onSettings: (data) => { setSettingsData(data); },
    onTokenUsage: () => { api.fetchTokenUsage().then(data => setTokenUsageData(data)).catch(() => {}); },
    onHealth: (data) => { setGatewayHealth(data); },
    onReconnect: () => { fetchData(); }
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && adminToken) {
        fetchData();
        checkGatewayHealth();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [adminToken, fetchData, checkGatewayHealth]);

  // 藉由 SSE 連線狀態與後端推送的事件判定 Gateway 健康狀態，不進行任何主動輪詢或主動 API 查詢
  useEffect(() => {
    if (!sseConnected) {
      setGatewayHealth(null);
    }
  }, [sseConnected]);

  const handleSyncModelsSilently = async () => {
    setIsSyncingModels(true);
    try {
      const data = await api.syncModels();
      if (data) fetchData();
    } catch (err) {
      console.error('Background model sync error:', err);
    } finally {
      setIsSyncingModels(false);
    }
  };

  const showSyncNotice = (type, message) => {
    if (syncNoticeTimerRef.current) clearTimeout(syncNoticeTimerRef.current);
    setSyncNotice({ type, message, createdAt: Date.now() });
    syncNoticeTimerRef.current = setTimeout(() => {
      setSyncNotice(null);
      syncNoticeTimerRef.current = null;
    }, type === 'error' ? 10000 : 7000);
  };

  const showKeyTestNotice = (type, message) => {
    if (keyTestNoticeTimerRef.current) clearTimeout(keyTestNoticeTimerRef.current);
    setKeyTestNotice({ type, message, createdAt: Date.now() });
    keyTestNoticeTimerRef.current = setTimeout(() => {
      setKeyTestNotice(null);
      keyTestNoticeTimerRef.current = null;
    }, type === 'error' ? 10000 : 7000);
  };

  const getSyncSourceLabel = (source) => {
    if (!source) return '';
    if (source.includes('build.nvidia.com')) return 'NVIDIA Build Free Endpoint';
    if (source.includes('featured-models')) return 'Featured Catalog';
    if (source.includes('/v1/models')) return '/v1/models';
    return source;
  };

  const formatModelSyncSummary = ({ parsedCount, savedCount, expectedCount, source }) => {
    const parts = [];
    if (Number.isFinite(Number(parsedCount))) parts.push(`${t('models.parsed')}: ${Number(parsedCount)}`);
    if (Number.isFinite(Number(savedCount))) parts.push(`${t('models.saved')}: ${Number(savedCount)}`);
    if (Number.isFinite(Number(expectedCount))) parts.push(`${t('models.expected')}: ${Number(expectedCount)}`);
    if (source) parts.push(`${t('models.source')}: ${getSyncSourceLabel(source)}`);
    return parts.join(' | ') || t('models.syncComplete');
  };

  const formatTaiwanParts = (value) => {
    if (!value) return null;
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      });
      return formatter.formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
    } catch (e) {
      console.error('formatTaiwanParts error:', e);
      return null;
    }
  };

  const formatTaiwanTime = (value) => {
    if (!value) return '--';
    const parts = formatTaiwanParts(value);
    if (!parts) {
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleTimeString('zh-TW', { hourCycle: 'h23' });
      } catch (err) {
        return typeof value === 'string' && value.length >= 19 ? value.substring(11, 19) : String(value);
      }
    }
    return `${parts.hour}:${parts.minute}:${parts.second}`;
  };

  const formatTaiwanDateTime = (value) => {
    if (!value) return '--';
    const parts = formatTaiwanParts(value);
    if (!parts) {
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleString('zh-TW', { hourCycle: 'h23' });
      } catch (err) {
        return String(value);
      }
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };

  const formatSyncTime = (isoString) => {
    if (!isoString) return '--';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '--';

    let locale = 'zh-TW';
    if (i18n.language) {
      if (i18n.language.startsWith('ja')) {
        locale = 'ja-JP';
      } else if (i18n.language.startsWith('en')) {
        locale = 'en-US';
      } else if (i18n.language.startsWith('zh')) {
        locale = 'zh-TW';
      } else {
        locale = i18n.language;
      }
    }

    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Taipei'
      }).format(date);
    } catch (e) {
      return date.toLocaleString();
    }
  };

  const handleSendTestMessage = async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !selectedTestModel || isChatting) return;

    const userMsg = { role: 'user', content: chatInput.trim() };
    const assistantMsg = { role: 'assistant', content: '' };

    setChatHistory(prev => [...prev, userMsg, assistantMsg]);
    const targetMessages = [...chatHistory, userMsg];
    setChatInput('');
    setIsChatting(true);

    try {
      const res = await fetch(GATEWAY_URL + '/api/test/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
        },
        body: JSON.stringify({
          model: selectedTestModel,
          messages: targetMessages,
          stream: true
        })
      });

      if (!res.ok) {
        const text = await res.text();
        setChatHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1].content = `Error (HTTP ${res.status}): ${text || 'Unable to test model'}`;
          return updated;
        });
        setIsChatting(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.choices && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                const deltaText = chunk.choices[0].delta.content;
                setChatHistory(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].content += deltaText;
                  return updated;
                });
              }
            } catch (err) {
              // ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setChatHistory(prev => {
        const updated = [...prev];
        updated[updated.length - 1].content = `Connection error: ${err.message}`;
        return updated;
      });
    } finally {
      setIsChatting(false);
    }
  };

  const handleAddKey = async (e) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    try {
      await api.addKey(newKey.trim());
      setNewKey('');
      fetchData();
    } catch (err) {
      alert(t('keys.addFailed', { error: err.message }));
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm(t('keys.deleteConfirm'))) return;
    try {
      await api.deleteKey(id);
      fetchData();
    } catch (err) {
      alert('Delete key error');
    }
  };

  const handleTestKeys = async () => {
    setIsTestingKeys(true);
    showKeyTestNotice('info', t('keys.testing'));
    try {
      const results = await api.testKeys();
      const failures = results.filter(r => !r.success);
      const successCount = results.length - failures.length;
      if (failures.length > 0) {
        showKeyTestNotice(
          'error',
          `${successCount}/${results.length} OK, ${failures.length} failed.`
        );
      } else {
        showKeyTestNotice('success', `${results.length}/${results.length} keys healthy.`);
      }
      fetchData();
    } catch (err) {
      showKeyTestNotice('error', `Test error: ${err.message}`);
    } finally {
      setIsTestingKeys(false);
    }
  };

  const handleSyncModels = async () => {
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
      fetchData();
    } catch (err) {
      showSyncNotice('error', `Sync failed: ${err.message}`);
    } finally {
      setIsSyncingModels(false);
    }
  };

  const saveModelPriorities = async (modelIds, groupId = activeModelGroup) => {
    try {
      await api.saveModelPriorities(modelIds, groupId);
      fetchData();
    } catch (err) {
      console.error('Save model priorities failed:', err);
      throw err;
    }
  };

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

  const getInsertOrder = useCallback((modelId, insertIndex, sourceOrder = models.map(m => m.model_id)) => {
    if (!modelId) return sourceOrder;

    const originalIndex = sourceOrder.indexOf(modelId);
    const withoutDragged = sourceOrder.filter(id => id !== modelId);
    let nextIndex = Math.max(0, Math.min(insertIndex, withoutDragged.length));

    if (originalIndex !== -1 && insertIndex > originalIndex) {
      nextIndex = Math.max(0, nextIndex - 1);
    }

    const updated = [...withoutDragged];
    updated.splice(nextIndex, 0, modelId);
    return updated;
  }, [models]);

  const getDropIndexFromEvent = useCallback((e, index) => {
    if (index === null || index === undefined) return models.length;
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }, [models.length]);

  const handleAddModelToPriority = (modelId, insertIndex = models.length) => {
    if (models.some(m => m.model_id === modelId)) return;
    const updated = getInsertOrder(modelId, insertIndex);
    setModels(buildModelsFromOrder(updated));
    saveModelPriorities(updated);
  };

  const handleAvailableModelDragStart = (e, modelId) => {
    if (!modelId || models.some(m => m.model_id === modelId)) return;
    setDraggedAvailableModelId(modelId);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-nvidia-model-id', modelId);
    e.dataTransfer.setData('text/plain', modelId);
  };

  const handleAvailableModelDragEnd = () => {
    setDraggedAvailableModelId(null);
    setIsPriorityDropActive(false);
    setPriorityDropIndex(null);
  };

  const handlePriorityDragOver = (e, index = null) => {
    const types = Array.from(e.dataTransfer.types || []);
    const hasAvailableModel = draggedAvailableModelId || types.includes('application/x-nvidia-model-id');
    const hasPriorityModel = draggedModelIndex !== null || types.includes('application/x-nvidia-priority-index');
    if (!hasAvailableModel && !hasPriorityModel) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasPriorityModel ? 'move' : 'copy';
    setIsPriorityDropActive(true);
    setPriorityDropIndex(getDropIndexFromEvent(e, index));
  };

  const handlePriorityDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsPriorityDropActive(false);
    setPriorityDropIndex(null);
  };

  const handlePriorityDrop = async (e, index = null) => {
    e.preventDefault();
    const modelId =
      e.dataTransfer.getData('application/x-nvidia-model-id') ||
      e.dataTransfer.getData('application/x-nvidia-priority-model-id') ||
      draggedAvailableModelId;
    if (!modelId) return;

    const insertIndex = index === null ? (priorityDropIndex ?? models.length) : getDropIndexFromEvent(e, index);
    const currentOrder = localModelOrderRef.current || models.map(m => m.model_id);
    const isExistingPriorityModel = currentOrder.includes(modelId);
    if (!isExistingPriorityModel && models.some(m => m.model_id === modelId)) return;

    const previousModels = models;
    const updated = getInsertOrder(modelId, insertIndex, currentOrder);
    setIsPriorityDropActive(false);
    setPriorityDropIndex(null);
    setDraggedModelIndex(null);
    setDraggedAvailableModelId(null);

    try {
      setModels(buildModelsFromOrder(updated));
      await saveModelPriorities(updated);
    } catch (err) {
      setModels(previousModels);
    } finally {
      localModelOrderRef.current = null;
    }
  };

  const handleRemoveModelFromPriority = (modelId) => {
    const updated = models.map(m => m.model_id).filter(id => id !== modelId);
    saveModelPriorities(updated);
  };

  const handleMovePriority = (index, direction) => {
    const updated = models.map(m => m.model_id);
    if (direction === 'up' && index > 0) {
      const temp = updated[index];
      updated[index] = updated[index - 1];
      updated[index - 1] = temp;
    } else if (direction === 'down' && index < updated.length - 1) {
      const temp = updated[index];
      updated[index] = updated[index + 1];
      updated[index + 1] = temp;
    }
    saveModelPriorities(updated);
  };

  const handleSwitchModelGroup = async (groupId) => {
    if (groupId === activeModelGroup) return;
    try {
      await api.setActiveModelGroup(groupId);
      setActiveModelGroup(groupId);
      fetchData();
    } catch (err) {
      alert(`Switch group failed: ${err.message}`);
    }
  };

  const handleAddRule = async (e) => {
    e.preventDefault();
    if (!newRuleTitle.trim() || !newRuleContent.trim()) return;
    try {
      await api.addRule(newRuleTitle.trim(), newRuleContent.trim());
      setNewRuleTitle('');
      setNewRuleContent('');
      fetchData();
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Add rule error');
    }
  };

  const handleDeleteRule = async (id) => {
    if (!confirm(t('rules.deleteConfirm'))) return;
    try {
      await api.deleteRule(id);
      fetchData();
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Delete rule error');
    }
  };

  const handleUpdateRule = async (id, title, content) => {
    await api.updateRule(id, title, content);
    fetchData();
    if (window.electronAPI?.notifyRulesUpdated) {
      window.electronAPI.notifyRulesUpdated();
    }
  };

  const saveSettings = async (updated) => {
    try {
      const data = await api.saveSettings(updated);
      setSettingsData(data);
    } catch (err) {
      console.error(err);
    }
  };

  const clearTokenUsage = async () => {
    if (!window.confirm(t('common.confirm'))) return;
    try {
      await api.clearTokenUsage();
      const data = await api.fetchTokenUsage();
      setTokenUsageData(data);
    } catch (err) {
      console.error(err);
    }
  };

  const showRestartNotice = useCallback((type, message) => {
    if (restartNoticeTimerRef.current) clearTimeout(restartNoticeTimerRef.current);
    setRestartNotice({ type, message });
    restartNoticeTimerRef.current = setTimeout(() => {
      setRestartNotice(null);
      restartNoticeTimerRef.current = null;
    }, 10000);
  }, []);

  const handleRestartGateway = useCallback(async () => {
    if (isRestartingGateway) return;
    if (!window.confirm(t('common.confirmRestartGateway'))) return;
    setIsRestartingGateway(true);
    showRestartNotice('info', t('dashboard.restarting') + '...');

    try {
      await api.resetCooldowns();
    } catch (_) {}

    if (window.electronAPI && window.electronAPI.restartGateway) {
      window.electronAPI.restartGateway();
      
      let attempts = 0;
      const maxAttempts = 30;
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 150));
        const health = await checkGatewayHealth();
        if (health && health.status === 'running') {
          showRestartNotice('success', `Gateway restarted! Uptime: ${Math.round(health.uptime)}s`);
          fetchData();
          break;
        }
        attempts++;
      }
      if (attempts >= maxAttempts) {
        showRestartNotice('error', 'Gateway restart timed out. Please check if port is in use.');
      }
    } else {
      try {
        await api.resetCooldowns();
        showRestartNotice('success', 'Cooldowns cleared, Gateway still running.');
        fetchData();
      } catch (err) {
        showRestartNotice('error', `Restart failed: ${err.message}`);
      }
    }

    setIsRestartingGateway(false);
  }, [isRestartingGateway, api, checkGatewayHealth, showRestartNotice, fetchData, t]);

  const handleRestartApp = useCallback(() => {
    if (!window.confirm(t('common.confirmRestartApp'))) return;
    if (window.electronAPI?.restartApp) {
      window.electronAPI.restartApp();
    }
  }, [t]);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const calculateSuccessRate = () => {
    if (stats.hourly.length === 0) return '100%';
    const totalRequests = stats.hourly.reduce((acc, curr) => acc + curr.request_count, 0);
    const totalSuccess = stats.hourly.reduce((acc, curr) => acc + curr.success_count, 0);
    if (totalRequests === 0) return '100%';
    return `${Math.round((totalSuccess / totalRequests) * 100)}%`;
  };

  const getTotalRequests = () => {
    return stats.hourly.reduce((acc, curr) => acc + curr.request_count, 0);
  };

  const isLogPanelNearBottom = () => {
    const el = logsContainerRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= 24;
  };

  const handleLogsScroll = () => {
    shouldAutoFollowLogsRef.current = isLogPanelNearBottom();
  };

  const scrollLogsToBottom = (behavior = 'auto') => {
    const el = logsContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const renderedLogRows = useMemo(() => {
    const isLight = theme === 'theme-light';
    return logs.map((log, index) => {
      if (!log) return null;

      let logColor = isLight ? '#1e3a8a' : '#dbeafe';
      let icon = 'ℹ️';

      if (log.type === 'success') {
        logColor = isLight ? '#047857' : '#34d399';
        icon = '✅';
      } else if (log.type === 'warning') {
        logColor = isLight ? '#b45309' : '#fbbf24';
        icon = '⚠️';
      } else if (log.type === 'error') {
        logColor = isLight ? '#b91c1c' : '#f87171';
        icon = '❌';
      }

      return (
        <div key={`${log.timestamp || 'log'}-${log.id || index}`} className="terminal-log-line">
          <span className="terminal-log-time">
            [{formatTaiwanTime(log.timestamp)}]
          </span>
          <span className="terminal-log-icon">
            {icon}
          </span>
          <span
            className="terminal-log-message"
            style={{ color: logColor }}
          >
            {translateLogMessage(log.message, i18n.language)}
          </span>
        </div>
      );
    });
  }, [logs, theme, i18n.language]);

  const getModelEmoji = (modelId) => {
    const id = modelId.toLowerCase();
    if (id.includes('llama')) return '🦙';
    if (id.includes('gpt')) return '🤖';
    if (id.includes('mistral') || id.includes('mixtral')) return '🌀';
    if (id.includes('gemma')) return '💎';
    if (id.includes('nemotron')) return '🧠';
    if (id.includes('phi')) return '🔤';
    if (id.includes('minimax') || id.includes('minimaxai')) return '🔲';
    if (id.includes('step')) return '🪜';
    if (id.includes('nvidia')) return '💚';
    if (id.includes('deepseek')) return '🔍';
    if (id.includes('qwen')) return '🐼';
    return '⚡';
  };

  const getModelCategory = (modelId) => {
    const id = modelId.toLowerCase();
    if (id.includes('llama')) return 'Llama';
    if (id.includes('gpt')) return 'GPT';
    if (id.includes('mistral') || id.includes('mixtral')) return 'Mistral';
    if (id.includes('gemma')) return 'Gemma';
    if (id.includes('nemotron')) return 'Nemotron';
    if (id.includes('phi')) return 'Phi';
    if (id.includes('minimax') || id.includes('minimaxai')) return 'MiniMax';
    if (id.includes('step')) return 'Step';
    if (id.includes('nvidia')) return 'Nvidia';
    return 'Other';
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div className="glass-panel" style={{ width: '240px', margin: '12px 6px 12px 12px', display: 'flex', flexDirection: 'column', padding: '20px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px', paddingLeft: '8px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={18} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '17px', fontWeight: '800', fontFamily: 'Outfit', letterSpacing: '0.5px' }}>{t('app.title')}</h1>
            <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '700' }}>{t('app.version', { version: packageJson.version })}</span>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <button
            className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={16} />
            <span>{t('nav.dashboard')}</span>
          </button>
          <button
            className={`btn ${activeTab === 'keys' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('keys')}
          >
            <Key size={16} />
            <span>{t('nav.keys', { active: stats.activeKeysCount, total: stats.keysCount })}</span>
          </button>
          <button
            className={`btn ${activeTab === 'models' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('models')}
          >
            <Cpu size={16} />
            <span>{t('nav.models', { count: stats.modelsCount })}</span>
          </button>
          <button
            className={`btn ${activeTab === 'playground' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('playground')}
          >
            <Play size={16} />
            <span>{t('nav.playground')}</span>
          </button>
          <button
            className={`btn ${activeTab === 'rules' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('rules')}
          >
            <FileText size={16} />
            <span>{t('nav.rules', { count: rules.length })}</span>
          </button>
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="glass-panel" style={{ padding: '10px 12px', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                  backgroundColor: gatewayHealth?.status === 'running' ? '#10b981' : (gatewayHealth === null ? '#ef4444' : '#f59e0b'),
                  boxShadow: gatewayHealth?.status === 'running' ? '0 0 6px rgba(16, 185, 129, 0.5)' : 'none'
                }} />
                <span style={{ fontSize: '12px', color: gatewayHealth?.status === 'running' ? '#10b981' : (gatewayHealth === null ? '#ef4444' : '#f59e0b'), fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {gatewayHealth?.status === 'running' ? t('dashboard.gatewayRunning') : (gatewayHealth === null ? t('dashboard.gatewayOffline') : t('dashboard.gatewayError'))}
                </span>
              </div>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexShrink: 0 }}
                onClick={handleRestartGateway}
                disabled={isRestartingGateway}
                title={t('dashboard.restart')}
              >
                {isRestartingGateway ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
                <span>{isRestartingGateway ? t('dashboard.restarting') : t('dashboard.restart')}</span>
              </button>
            </div>
            {gatewayHealth?.status === 'running' && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                <span>{t('dashboard.uptime', { minutes: Math.round(gatewayHealth.uptime / 60) })}</span>
                <span>{t('dashboard.keysStatus', { active: gatewayHealth.keys?.active, total: gatewayHealth.keys?.total })}</span>
              </div>
            )}
          </div>

          {restartNotice && (
            <div
              className={`sync-notice sync-notice-${restartNotice.type}`}
              role="status"
              aria-live="polite"
              style={{ fontSize: '12px' }}
            >
              {restartNotice.type === 'info' && <Loader2 size={11} className="animate-spin" style={{ marginRight: '4px', flexShrink: 0, verticalAlign: 'middle' }} />}
              {restartNotice.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
            {LANGUAGE_OPTIONS.map(lang => (
              <button
                key={lang.code}
                className={`btn ${i18n.language === lang.code ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 8px', fontSize: '11px', minWidth: '32px' }}
                onClick={() => i18n.changeLanguage(lang.code)}
                title={lang.code}
              >
                <Globe size={10} />
                <span>{lang.label}</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => {
                setTempSettings({ ...settingsData });
                setIsSettingsModalOpen(true);
              }}
              className="btn btn-secondary"
              style={{ flex: 1, padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              ⚙️ {t('settings.settingsButton')}
            </button>
            <button
              onClick={() => setTheme(prev => prev === 'theme-dark' ? 'theme-light' : 'theme-dark')}
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title={t('common.toggleTheme')}
            >
              {theme === 'theme-dark' ? '☀️' : '🌙'}
            </button>
          </div>
          <button
            className="btn btn-danger"
            style={{ padding: '8px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onClick={handleRestartApp}
            title={t('dashboard.restartApp')}
          >
            <Power size={14} />
            <span>{t('dashboard.restartApp')}</span>
          </button>
        </div>

        {apiError && (
          <div className="glass-panel badge-inactive" style={{ padding: '12px', fontSize: '13px', borderRadius: '8px', marginTop: '12px', whiteSpace: 'normal', lineHeight: '1.4' }}>
            <ShieldAlert size={14} style={{ marginRight: '6px', flexShrink: 0 }} />
            {apiError}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '12px 12px 12px 6px', overflow: 'hidden' }}>

        {activeTab === 'dashboard' && (
          <div className="animate-fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
            <div className="glass-panel" style={{ padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className={`btn ${dashboardSubTab === 'overview' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 14px', fontSize: '14px' }}
                  onClick={() => setDashboardSubTab('overview')}
                >
                  <Activity size={14} />
                  <span>{t('dashboard.overview')}</span>
                </button>
                <button
                  className={`btn ${dashboardSubTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 14px', fontSize: '14px' }}
                  onClick={() => setDashboardSubTab('logs')}
                >
                  <RefreshCw size={14} className={dashboardSubTab === 'logs' && logs.length > 0 ? 'animate-spin' : ''} />
                  <span>{t('dashboard.logs')}</span>
                </button>
                <button
                  className={`btn ${dashboardSubTab === 'tokens' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 14px', fontSize: '14px' }}
                  onClick={() => setDashboardSubTab('tokens')}
                >
                  <Cpu size={14} />
                  <span>{t('dashboard.tokens')}</span>
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>{t('common.sse')}</span>
                <div style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: sseConnected ? '#10b981' : '#ef4444',
                  boxShadow: sseConnected ? '0 0 6px rgba(16,185,129,0.5)' : 'none'
                }} />
              </div>
            </div>

            {dashboardSubTab === 'overview' && (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              <div
                className="glass-panel"
                style={{
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => copyToClipboard('http://127.0.0.1:4000/v1', 'gateway_endpoint')}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                title={t('app.copyToClipboard')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('app.endpoint')}</span>
                  {copiedId === 'gateway_endpoint' ? (
                    <span style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <Check size={12} />{t('app.copyToClipboard')}
                    </span>
                  ) : (
                    <Copy size={12} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span style={{ fontSize: '17px', fontWeight: '700', color: '#10b981', fontFamily: 'Outfit' }}>http://127.0.0.1:4000/v1</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></div>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('app.copyToClipboard')} (Port 4000)</span>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('dashboard.activeKeys')}</span>
                <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'Outfit' }}>
                  {stats.activeKeysCount} <span style={{ fontSize: '16px', color: 'var(--text-secondary)', fontWeight: '400' }}>/ {stats.keysCount}</span>
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('dashboard.cooldownPool')}</span>
              </div>

              <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('dashboard.recentRequests')}</span>
                <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'Outfit' }}>
                  {getTotalRequests()} <span style={{ fontSize: '16px', color: '#10b981', fontWeight: '600' }}>({calculateSuccessRate()})</span>
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('dashboard.only429Triggers')}</span>
              </div>

              <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{t('dashboard.primaryModel')}</span>
                <span style={{ fontSize: '16px', fontWeight: '700', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={models[0]?.model_id || '--'}>
                  {models[0] ? models[0].model_id.split('/').pop() : '--'}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('dashboard.priority', { n: 1 })}</span>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#10b981' }}>⚙️ {t('dashboard.openaiTitle')}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <div
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '8px',
                    position: 'relative',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard('myself', 'prov_id')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title={t('dashboard.copyProviderId')}
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.providerId')}</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>myself</div>
                  <div
                    className="btn btn-secondary"
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_id' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
                <div
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '8px',
                    position: 'relative',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard(getGatewayUrl() + '/v1', 'prov_url')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title={t('dashboard.copyBaseUrl')}
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.baseUrl')}</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>{getGatewayUrl()}/v1</div>
                  <div
                    className="btn btn-secondary"
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_url' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
                <div
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '8px',
                    position: 'relative',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard(String(activeModelGroup), 'prov_key')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title={t('dashboard.copyApiKey')}
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.apiKeyGroup')}</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>1 / 2 / 3</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{t('dashboard.apiKeyGroupText', { group: activeModelGroup })}</div>
                  <div
                    className="btn btn-secondary"
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_key' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
                <div
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '8px',
                    position: 'relative',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard('patcher-main', 'prov_model')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title={t('dashboard.copyModelId')}
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('dashboard.modelId')}</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>patcher-main</div>
                  <div
                    className="btn btn-secondary"
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_model' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {t('dashboard.providerTip')}
              </span>
            </div>

            <div className="glass-panel" style={{ padding: '20px', flex: '1', minHeight: '180px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '16px', fontWeight: '700' }}>{t('dashboard.hourlyTraffic')}</span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>SQLite</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '42px 0 8px', overflow: 'visible' }}>
                {stats.hourly.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', fontSize: '15px' }}>
                    {t('dashboard.noData')}
                  </div>
                ) : (
                  stats.hourly.map((h, i) => {
                    const maxRequests = Math.max(...stats.hourly.map(x => x.request_count), 1);
                    const barHeightPercent = h.request_count > 0 ? Math.max((h.request_count / maxRequests) * 100, 5) : 0;
                    const errorHeightPercent = h.request_count > 0 ? Math.min((h.error_count / h.request_count) * 100, 100) : 0;
                    const hourText = h.hour.split(' ')[1];
                    const isHovered = hoveredHourlyIndex === i;
                    return (
                      <div
                        key={i}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', minWidth: '28px', position: 'relative' }}
                        onMouseEnter={() => setHoveredHourlyIndex(i)}
                        onMouseLeave={() => setHoveredHourlyIndex(null)}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: '-36px',
                            left: i < 3 ? '0' : (i > stats.hourly.length - 3 ? 'auto' : '50%'),
                            right: i > stats.hourly.length - 3 ? '0' : 'auto',
                            transform: i < 3 || i > stats.hourly.length - 3
                              ? `translateY(${isHovered ? '0' : '6px'})`
                              : `translateX(-50%) translateY(${isHovered ? '0' : '6px'})`,
                            opacity: isHovered ? 1 : 0,
                            pointerEvents: 'none',
                            transition: 'opacity 180ms ease, transform 180ms ease',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '6px 8px',
                            boxShadow: 'var(--card-shadow)',
                            fontSize: '12px',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            zIndex: 5
                          }}
                        >
                          {t('dashboard.hourTooltip', { hour: hourText, total: h.request_count, ok: h.success_count, err: h.error_count })}
                        </div>
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
                          <div
                            style={{
                              width: '100%',
                              height: `${barHeightPercent}%`,
                              background: 'linear-gradient(to top, rgba(16, 185, 129, 0.22) 0%, rgba(16, 185, 129, 0.82) 100%)',
                              borderRadius: '4px 4px 0 0',
                              transition: 'height 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms ease, box-shadow 180ms ease, filter 180ms ease',
                              transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                              boxShadow: isHovered ? '0 0 18px rgba(16, 185, 129, 0.35)' : 'none',
                              filter: isHovered ? 'brightness(1.12)' : 'brightness(1)',
                              position: 'relative',
                              overflow: 'hidden',
                              cursor: 'default'
                            }}
                            title={t('dashboard.hourTooltip', { hour: h.hour, total: h.request_count, ok: h.success_count, err: h.error_count })}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: '100%',
                                height: `${errorHeightPercent}%`,
                                background: 'rgba(239, 68, 68, 0.62)',
                                minHeight: h.error_count > 0 ? '2px' : '0',
                                transition: 'height 450ms cubic-bezier(0.22, 1, 0.36, 1)'
                              }}
                            />
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', color: isHovered ? '#10b981' : 'var(--text-muted)', transition: 'color 180ms ease' }}>{hourText}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            </>
            )}

            {dashboardSubTab === 'logs' && (
            <ErrorBoundary name="DashboardLogs">
            <div className="glass-panel" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={14} className={logs.length > 0 ? 'animate-spin' : ''} style={{ animationDuration: '3s', color: '#10b981' }} />
                  <span style={{ fontSize: '16px', fontWeight: '700' }}>{t('dashboard.logTitle')}</span>
                </div>
                <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={fetchData}>
                  {t('dashboard.refresh')}
                </button>
              </div>

              <div className="terminal-log-panel">
                {logs.length === 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px' }}>
                    {t('dashboard.waiting')}
                  </div>
                ) : (
                  <div
                    ref={logsContainerRef}
                    className="terminal-log-lines"
                    onScroll={handleLogsScroll}
                  >
                    {renderedLogRows}
                  </div>
                )}
              </div>
            </div>
            </ErrorBoundary>
            )}

            {dashboardSubTab === 'tokens' && (() => {
              const pricing = tokenUsageData.pricing || {};
              const pPrice = Number(pricing.pricePerMillionPromptTokens) || 0;
              const cPrice = Number(pricing.pricePerMillionCompletionTokens) || 0;
              const refPPrice = Number(pricing.refPricePerMillionPromptTokens) || 0;
              const refCPrice = Number(pricing.refPricePerMillionCompletionTokens) || 0;
              const curSym = pricing.currencySymbol || 'USD';

              const totalPromptCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_prompt_tokens / 1_000_000) * pPrice, 0);
              const totalCompletionCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_completion_tokens / 1_000_000) * cPrice, 0);
              const totalActualCost = totalPromptCost + totalCompletionCost;

              const totalRefPromptCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_prompt_tokens / 1_000_000) * refPPrice, 0);
              const totalRefCompletionCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_completion_tokens / 1_000_000) * refCPrice, 0);
              const totalRefCost = totalRefPromptCost + totalRefCompletionCost;

              const totalSavings = Math.max(0, totalRefCost - totalActualCost);

              const formatCost = (val) => {
                if (val < 0.01 && val > 0) return `<${(0.01).toFixed(2)}`;
                return val.toFixed(4);
              };

              return (
            <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '16px', fontWeight: '700' }}>📊 {t('dashboard.tokens')}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={() => api.fetchTokenUsage().then(data => setTokenUsageData(data)).catch(() => {})}>
                    {t('dashboard.refresh')}
                  </button>
                  <button className="btn btn-danger" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={clearTokenUsage}>
                    {t('dashboard.clear')}
                  </button>
                </div>
              </div>

              {tokenUsageData.stats.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('dashboard.actualCost', { symbol: curSym })}</div>
                    <div className="token-cost" style={{ fontSize: '18px', fontWeight: '700' }}>{curSym} {formatCost(totalActualCost)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      P: {formatCost(totalPromptCost)} | C: {formatCost(totalCompletionCost)}
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('dashboard.referenceCost', { symbol: curSym })}</div>
                    <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-secondary)' }}>{curSym} {formatCost(totalRefCost)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {t('dashboard.referenceCostDesc')}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid var(--accent-color)', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--accent-color)', marginBottom: '4px', fontWeight: '600' }}>💰 {t('dashboard.savings', { symbol: curSym })}</div>
                    <div className="token-cost-total" style={{ fontSize: '20px', fontWeight: '800' }}>{curSym} {formatCost(totalSavings)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-active)', marginTop: '4px', fontWeight: '500' }}>
                      {t('dashboard.savingsDesc')}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', paddingRight: '4px' }}>
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-secondary)' }}>{t('dashboard.tokenStats')}</h3>
                  {tokenUsageData.stats.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-tertiary)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '14px' }}>
                      {t('dashboard.noData')}
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                      <table className="token-usage-table">
                        <thead>
                          <tr>
                            <th>{t('dashboard.thModelId')}</th>
                            <th>{t('dashboard.thPrompt')}</th>
                            <th>{t('dashboard.thCompletion')}</th>
                            <th>{t('dashboard.thTotal')}</th>
                            <th>{t('dashboard.thCalls')}</th>
                            <th>{t('dashboard.thCost', { symbol: curSym })}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tokenUsageData.stats.map((stat, idx) => {
                            const statCost = (stat.total_prompt_tokens / 1_000_000) * pPrice + (stat.total_completion_tokens / 1_000_000) * cPrice;
                            return (
                            <tr key={idx}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span>{getModelEmoji(stat.model_id)}</span>
                                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: '600' }}>{stat.model_id}</span>
                                </div>
                              </td>
                              <td>{stat.total_prompt_tokens.toLocaleString()}</td>
                              <td>{stat.total_completion_tokens.toLocaleString()}</td>
                              <td style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{stat.total_total_tokens.toLocaleString()}</td>
                              <td>{stat.request_count}</td>
                              <td className="token-cost">{formatCost(statCost)}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '350px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                    {t('dashboard.tokenDetails')}
                    <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      {t('dashboard.tokenHelp')}
                    </span>
                  </h3>
                  {tokenUsageData.logs.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-tertiary)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '14px', flex: 1 }}>
                      {t('dashboard.noRecords')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div className="token-log-header">
                        <span>{t('dashboard.time')}</span>
                        <span>{t('dashboard.requestId')}</span>
                        <span>{t('dashboard.tokenModel')}</span>
                        <span>{t('dashboard.prompt')}</span>
                        <span>{t('dashboard.completion')}</span>
                        <span>{t('dashboard.total')}</span>
                        <span style={{ textAlign: 'right', paddingRight: '4px' }}>{t('dashboard.cost')}</span>
                      </div>

                      {tokenUsageData.logs.map((log, idx) => {
                        const isExpanded = expandedTokenLogId === log.id;
                        const activeDetailTab = expandedTokenLogTabs[log.id] || 'metadata';
                        const logCost = (log.prompt_tokens / 1_000_000) * pPrice + (log.completion_tokens / 1_000_000) * cPrice;
                        const modelInfo = availableModels.find(m => m.id === log.model_id);

                        const handleFieldClick = (fieldTab) => {
                          const isCurrentlyExpanded = expandedTokenLogId === log.id;
                          const currentTab = expandedTokenLogTabs[log.id];
                          if (isCurrentlyExpanded && currentTab === fieldTab) {
                            setExpandedTokenLogId(null);
                          } else {
                            setExpandedTokenLogId(log.id);
                            setExpandedTokenLogTabs({
                              ...expandedTokenLogTabs,
                              [log.id]: fieldTab
                            });
                          }
                        };

                        return (
                          <div key={log.id || idx} style={{ marginBottom: '2px' }}>
                            <div
                              className={isExpanded ? 'token-row-expanded' : ''}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '72px 70px 1fr 70px 90px 70px 80px',
                                gap: '0',
                                alignItems: 'center',
                                padding: '10px 11px',
                                background: isExpanded ? 'rgba(16, 185, 129, 0.06)' : 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                borderTop: 'none',
                                cursor: 'pointer',
                                fontSize: '13px',
                                transition: 'background 150ms ease'
                              }}
                            >
                              <span onClick={() => handleFieldClick('raw')} style={{ color: 'var(--text-muted)' }}>
                                {formatTaiwanTime(log.timestamp)}
                              </span>
                              <span onClick={() => handleFieldClick('raw')} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
                                #{log.request_id || 'test'}
                              </span>
                              <span onClick={() => handleFieldClick('model')} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }} title={t('common.clickForModelCard')}>
                                <span>{getModelEmoji(log.model_id)}</span>
                                <span style={{ fontFamily: 'ui-monospace, monospace', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                                  {log.model_id.split('/').pop()}
                                </span>
                              </span>
                              <span onClick={() => handleFieldClick('metadata')} style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }} title={t('common.clickForMetadata')}>
                                {log.prompt_tokens.toLocaleString()}
                              </span>
                              <span onClick={() => handleFieldClick('metadata')} style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }} title="Click for metadata">
                                {log.completion_tokens.toLocaleString()}
                              </span>
                              <span onClick={() => handleFieldClick('metadata')} style={{ fontWeight: '700', color: 'var(--accent-color)', textDecoration: 'underline', textDecorationStyle: 'dotted' }} title="Click for metadata">
                                {log.total_tokens.toLocaleString()}
                              </span>
                              <span onClick={() => handleFieldClick('raw')} className="token-cost" style={{ textAlign: 'right', fontSize: '12px' }}>
                                {formatCost(logCost)}
                              </span>
                            </div>

                            {isExpanded && (
                              <div className="token-detail-panel" style={{ padding: '16px' }}>
                                <div className="token-detail-tabs">
                                  <div
                                    className={`token-detail-tab ${activeDetailTab === 'metadata' ? 'active' : ''}`}
                                    onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'metadata' })}
                                  >
                                    📋 Metadata
                                  </div>
                                  <div
                                    className={`token-detail-tab ${activeDetailTab === 'prompts' ? 'active' : ''}`}
                                    onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'prompts' })}
                                  >
                                    {t('dashboard.tabPrompts')}
                                  </div>
                                  <div
                                    className={`token-detail-tab ${activeDetailTab === 'model' ? 'active' : ''}`}
                                    onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'model' })}
                                  >
                                    🎴 Model Card
                                  </div>
                                  <div
                                    className={`token-detail-tab ${activeDetailTab === 'raw' ? 'active' : ''}`}
                                    onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'raw' })}
                                  >
                                    ⚙️ Raw JSON
                                  </div>
                                </div>

                                {activeDetailTab === 'metadata' && (
                                  <pre style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    padding: '12px',
                                    fontSize: '12px',
                                    overflow: 'auto',
                                    maxHeight: '300px'
                                  }}>
                                    {JSON.stringify({
                                      model_id: log.model_id,
                                      prompt_tokens: log.prompt_tokens,
                                      completion_tokens: log.completion_tokens,
                                      total_tokens: log.total_tokens,
                                      request_id: log.request_id,
                                      timestamp: log.timestamp,
                                      metadata: log.metadata || null
                                    }, null, 2)}
                                  </pre>
                                )}

                                {activeDetailTab === 'prompts' && (
                                  <div className="token-chat-container">
                                    {(() => {
                                      try {
                                        const renderContent = (content) => {
                                          if (content === null || content === undefined) return '';
                                          if (typeof content === 'string') return content;
                                          if (Array.isArray(content)) {
                                            return content.map((item) => {
                                              if (typeof item === 'string') return item;
                                              if (item && typeof item === 'object') {
                                                if (item.type === 'text') return item.text || '';
                                                return item.text || JSON.stringify(item);
                                              }
                                              return String(item);
                                            }).join('\n');
                                          }
                                          if (typeof content === 'object') {
                                            return content.text || JSON.stringify(content);
                                          }
                                          return String(content);
                                        };

                                        const chatItems = [];

                                        let parsed = null;
                                        if (typeof log.request_body === 'string') {
                                          parsed = JSON.parse(log.request_body);
                                        } else {
                                          parsed = log.request_body;
                                        }
                                        let messages = null;
                                        if (parsed) {
                                          if (Array.isArray(parsed)) {
                                            messages = parsed;
                                          } else if (Array.isArray(parsed.messages)) {
                                            messages = parsed.messages;
                                          }
                                        }
                                        if (Array.isArray(messages)) {
                                          messages.forEach((m) => {
                                            chatItems.push({ role: m.role || 'unknown', content: renderContent(m.content) });
                                          });
                                        }

                                        const output = log.response_content;
                                        if (output) {
                                          chatItems.push({ role: 'assistant', content: renderContent(output) });
                                        }

                                        if (chatItems.length === 0) {
                                          return <div style={{ color: 'var(--text-muted)' }}>{t('dashboard.noInputData')}</div>;
                                        }

                                        return chatItems.map((item, idx) => {
                                          const isUser = item.role === 'user';
                                          const isAssistant = item.role === 'assistant';
                                          const isTool = item.role === 'tool';
                                          const isSystem = item.role === 'system';
                                          const bubbleClass = isUser ? 'user' : (isAssistant ? 'assistant' : (isTool ? 'tool' : 'system'));
                                          return (
                                            <div key={idx} className={`token-chat-message ${bubbleClass}`}>
                                              <div className="token-chat-role">{item.role}</div>
                                              <pre className="token-chat-content">{item.content}</pre>
                                            </div>
                                          );
                                        });
                                      } catch (_) {
                                        return <div style={{ color: 'var(--text-muted)' }}>{t('dashboard.noInputData')}</div>;
                                      }
                                    })()}
                                  </div>
                                )}

                                {activeDetailTab === 'model' && (
                                  <div className="token-model-card">
                                    <div className="token-model-card-icon" style={{ background: 'rgba(16, 185, 129, 0.12)' }}>
                                      {getModelEmoji(log.model_id)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                                        {modelInfo?.name || log.model_id.split('/').pop()}
                                      </div>
                                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: '2px' }}>
                                        {log.model_id}
                                      </div>
                                      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>NIM: Prompt <strong>${pPrice}</strong> / Completion <strong>${cPrice}</strong> (per M)</span>
                                        <span style={{ color: 'var(--text-muted)' }}>Ref: Prompt <strong>${refPPrice}</strong> / Completion <strong>${refCPrice}</strong> (per M)</span>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {activeDetailTab === 'raw' && (
                                  <div>
                                    <pre style={{
                                      background: 'var(--bg-primary)',
                                      border: '1px solid var(--border-color)',
                                      borderRadius: '8px',
                                      padding: '12px',
                                      fontSize: '12px',
                                      overflow: 'auto',
                                      maxHeight: '300px'
                                    }}>
                                      {JSON.stringify(log, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })()}
          </div>
        )}

        {activeTab === 'keys' && (
          <ErrorBoundary name="KeysPanel">
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('keys.title')}</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>{t('keys.description')}</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleTestKeys}
                  disabled={isTestingKeys || keys.length === 0}
                >
                  <RefreshCw size={14} className={isTestingKeys ? 'animate-spin' : ''} />
                  <span>{isTestingKeys ? t('keys.testing') : t('keys.testAll')}</span>
                </button>
              </div>
            </div>

            {keyTestNotice && (
              <div
                className={`sync-notice sync-notice-${keyTestNotice.type}`}
                role="status"
                aria-live="polite"
                style={{ alignSelf: 'flex-start' }}
              >
                {keyTestNotice.message}
              </div>
            )}

            <form onSubmit={handleAddKey} style={{ display: 'flex', gap: '10px' }}>
              <input
                type="password"
                placeholder={t('keys.addPlaceholder')}
                className="input"
                style={{ flex: 1 }}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                <Plus size={16} />
                <span>{t('keys.addButton')}</span>
              </button>
            </form>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '12px' }}>{t('keys.apiKeyColumn')}</th>
                    <th style={{ padding: '12px' }}>{t('keys.status')}</th>
                    <th style={{ padding: '12px' }}>{t('keys.consecutiveFails')}</th>
                    <th style={{ padding: '12px' }}>{t('keys.totalErrors')}</th>
                    <th style={{ padding: '12px' }}>{t('keys.lastUsed')}</th>
                    <th style={{ padding: '12px' }}>{t('keys.errorReason')}</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>{t('keys.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {t('keys.noKeys')}
                      </td>
                    </tr>
                  ) : (
                    keys.map((k) => {
                      let badgeClass = 'badge-active';
                      let statusText = t('keys.active');
                      if (k.status === 'cooldown') {
                        const cooldownUntilMs = k.cooldown_until ? new Date(k.cooldown_until).getTime() : 0;
                        const secLeft = Math.max(0, Math.ceil((cooldownUntilMs - currentTimeMs) / 1000));
                        if (secLeft > 0) {
                          badgeClass = 'badge-cooldown';
                          statusText = t('keys.cooldown', { sec: secLeft });
                        } else {
                          badgeClass = 'badge-active';
                          statusText = t('keys.active');
                        }
                      } else if (k.status === 'inactive') {
                        badgeClass = 'badge-inactive';
                        statusText = t('keys.inactive');
                      }

                      return (
                        <tr key={k.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                            {k.masked_key || `nvapi-****...${k.key_suffix || ''}`}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span className={`badge ${badgeClass}`}>{statusText}</span>
                          </td>
                          <td style={{ padding: '12px', color: k.consecutive_failures > 0 ? '#fbbf24' : 'inherit' }}>
                            {k.consecutive_failures}
                          </td>
                          <td style={{ padding: '12px', color: k.total_errors > 0 ? '#f87171' : 'inherit' }}>
                            {k.total_errors}
                          </td>
                          <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                            {k.last_used_at ? formatTaiwanTime(k.last_used_at) : t('keys.unused')}
                          </td>
                          <td style={{ padding: '12px', color: '#f87171', fontSize: '13px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.last_error_message}>
                            {k.last_error_message || '--'}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button className="btn btn-danger" style={{ padding: '6px 8px' }} onClick={() => handleDeleteKey(k.id)}>
                              <Trash size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </ErrorBoundary>
        )}

        {activeTab === 'models' && (
          <ErrorBoundary name="ModelsPanel">
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('models.title')}</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {t('models.description')}
                </p>
                {lastSyncTime && (
                  <div className="sync-info-container">
                    <div className="sync-info-chip last-sync" title={t('models.lastSync')}>
                      <RefreshCw size={12} className={isSyncingModels ? 'animate-spin' : ''} />
                      <span>{t('models.lastSync')}: {formatSyncTime(lastSyncTime)}</span>
                    </div>
                    {Number.isFinite(Number(lastParsedModelCount ?? availableModels.length)) && (
                      <div className="sync-info-chip parsed">
                        <Cpu size={12} />
                        <span>{t('models.parsed')}: {lastParsedModelCount ?? availableModels.length}</span>
                      </div>
                    )}
                    {Number.isFinite(Number(lastSavedModelCount ?? availableModels.length)) && (
                      <div className="sync-info-chip saved">
                        <CheckCircle size={12} />
                        <span>{t('models.saved')}: {lastSavedModelCount ?? availableModels.length}</span>
                      </div>
                    )}
                    {Number.isFinite(Number(expectedModelCount)) && (
                      <div className="sync-info-chip expected">
                        <Activity size={12} />
                        <span>{t('models.expected')}: {expectedModelCount}</span>
                      </div>
                    )}
                    {lastSyncSource && (
                      <div className="sync-info-chip source">
                        <Globe size={12} />
                        <span>{t('models.source')}: {getSyncSourceLabel(lastSyncSource)}</span>
                      </div>
                    )}
                  </div>
                )}
                {syncNotice && (
                  <div
                    className={`sync-notice sync-notice-${syncNotice.type}`}
                    role="status"
                    aria-live="polite"
                    style={{ marginTop: '8px' }}
                  >
                    {syncNotice.message}
                  </div>
                )}
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleSyncModels}
                disabled={isSyncingModels}
              >
                <RefreshCw size={14} className={isSyncingModels ? 'animate-spin' : ''} />
                <span>{isSyncingModels ? t('models.syncing') : t('models.syncButton')}</span>
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', gap: '20px', overflow: 'hidden' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700' }}>⚙️ {t('models.currentOrder', { group: activeModelGroup })}</h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', minWidth: 0 }}>
                  {[1, 2, 3].map((groupId) => {
                    const groupInfo = modelGroups.find(g => g.group_id === groupId) || { count: groupId === activeModelGroup ? models.length : 0, primary_model: null };
                    const primaryText = groupInfo.primary_model ? groupInfo.primary_model.split('/').pop() : '--';
                    return (
                      <button
                        key={groupId}
                        className={`btn ${activeModelGroup === groupId ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '8px 10px', fontSize: '13px', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', minWidth: 0, overflow: 'hidden' }}
                        onClick={() => handleSwitchModelGroup(groupId)}
                        title={t('models.groupLabel', { group: groupId })}
                      >
                        <span style={{ fontWeight: '800' }}>{t('models.groupLabel', { group: groupId })} {activeModelGroup === groupId ? t('models.activeGroup') : t('models.switchable')}</span>
                        <span className="model-group-summary-line">
                          <span className="model-group-count">{groupInfo.count || 0} | </span>
                          <span className="model-group-marquee" title={primaryText}>
                            <span className="model-group-marquee-track">
                              <span>{primaryText}</span>
                              <span className="model-group-marquee-spacer">　　</span>
                              <span aria-hidden="true">{primaryText}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  className={`priority-drop-zone ${isPriorityDropActive ? 'is-drag-over' : ''}`}
                  style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                  onDragOver={(e) => handlePriorityDragOver(e)}
                  onDragLeave={handlePriorityDragLeave}
                  onDrop={(e) => handlePriorityDrop(e)}
                >
                  {models.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px' }}>
                      {t('models.noModels')}
                    </div>
                  ) : (
                    <>
                    {models.map((m, index) => (
                      <React.Fragment key={m.id || m.model_id}>
                      {priorityDropIndex === index && (
                        <div className="priority-drop-indicator" aria-hidden="true" />
                      )}
                      <div
                        className={`glass-panel priority-model-card ${draggedModelIndex === index ? 'is-dragging' : ''}`}
                        style={{
                          padding: '12px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          border: '1px solid var(--border-color)',
                          borderLeft: `5px solid ${index === 0 ? 'var(--status-active)' : 'var(--status-cooldown)'}`,
                          borderRadius: '8px',
                          cursor: 'move',
                          background: 'var(--bg-secondary)',
                          marginBottom: '4px'
                        }}
                        draggable
                        onDragStart={(e) => {
                          setDraggedModelIndex(index);
                          localModelOrderRef.current = models.map(m2 => m2.model_id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('application/x-nvidia-priority-index', String(index));
                          e.dataTransfer.setData('application/x-nvidia-priority-model-id', m.model_id);
                          e.dataTransfer.setData('text/plain', m.model_id);
                        }}
                        onDragOver={(e) => {
                          e.stopPropagation();
                          handlePriorityDragOver(e, index);
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          handlePriorityDrop(e, index);
                        }}
                        onDragEnd={() => {
                          setDraggedModelIndex(null);
                          setDraggedAvailableModelId(null);
                          setIsPriorityDropActive(false);
                          setPriorityDropIndex(null);
                          localModelOrderRef.current = null;
                        }}
                        title={t('common.dragToReorder')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '75%', minWidth: 0 }}>
                          <span style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: index === 0 ? 'var(--bg-active)' : 'var(--bg-cooldown)',
                            color: index === 0 ? 'var(--text-active)' : 'var(--text-cooldown)',
                            border: `1px solid ${index === 0 ? 'var(--border-active)' : 'var(--border-cooldown)'}`,
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap'
                          }}>
                            #{m.priority} {index === 0 ? t('models.primary') : t('models.backup')}
                          </span>
                          <span style={{ fontSize: '14px', fontWeight: '600', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{m.model_id}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-secondary" style={{ padding: '6px' }} disabled={index === 0} onClick={() => handleMovePriority(index, 'up')}>
                            <ArrowUp size={12} />
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '6px' }} disabled={index === models.length - 1} onClick={() => handleMovePriority(index, 'down')}>
                            <ArrowDown size={12} />
                          </button>
                          <button className="btn btn-danger" style={{ padding: '6px' }} onClick={() => handleRemoveModelFromPriority(m.model_id)}>
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      </React.Fragment>
                    ))}
                    {priorityDropIndex === models.length && (
                      <div className="priority-drop-indicator" aria-hidden="true" />
                    )}
                    </>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700' }}>🌐 {t('models.availableModels')}</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder={t('models.searchPlaceholder')}
                    className="input"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '15px' }}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {['ALL', 'Llama', 'GPT', 'Nemotron', 'Phi', 'MiniMax', 'Step', 'Nvidia', 'Other'].map(cat => (
                      <button
                        key={cat}
                        className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '4px 10px', fontSize: '13px', borderRadius: '6px' }}
                        onClick={() => setSelectedCategory(cat)}
                      >
                        {cat === 'ALL' ? 'All' : cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {availableModels.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', padding: '20px' }}>
                      {t('models.noSyncData')}
                    </div>
                  ) : (
                    (() => {
                      const searchTerms = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
                      const filtered = availableModels.filter(am => {
                        const matchesSearch = searchTerms.length === 0 || searchTerms.some(term =>
                          am.name.toLowerCase().includes(term) || am.id.toLowerCase().includes(term)
                        );
                        const matchesCategory = selectedCategory === 'ALL' || getModelCategory(am.id) === selectedCategory;
                        return matchesSearch && matchesCategory;
                      });

                      if (filtered.length === 0) {
                        return (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', padding: '20px' }}>
                            {t('models.noCategoryMatch')}
                          </div>
                        );
                      }

                      return filtered.map((am) => {
                        const isAdded = models.some(m => m.model_id === am.id);
                        return (
                          <div
                            key={am.id}
                            className={`available-model-card ${isAdded ? 'is-added' : ''}`}
                            draggable={!isAdded}
                            onDragStart={(e) => handleAvailableModelDragStart(e, am.id)}
                            onDragEnd={handleAvailableModelDragEnd}
                            title={isAdded ? 'Already in priority list' : 'Drag to priority list'}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '12px 14px',
                              background: isAdded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '8px',
                              opacity: draggedAvailableModelId === am.id ? 0.55 : 1,
                              boxShadow: 'var(--card-shadow)',
                              marginBottom: '2px'
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '80%', minWidth: 0, gap: '2px' }}>
                              <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{am.name}</span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{am.id}</span>
                            </div>
                            <button
                              className={isAdded ? 'btn btn-secondary' : 'btn btn-primary'}
                              style={{ padding: '6px 12px', fontSize: '13px', opacity: isAdded ? 0.7 : 1 }}
                              disabled={isAdded}
                              onClick={() => !isAdded && handleAddModelToPriority(am.id)}
                            >
                              {isAdded ? t('models.added') : t('models.add')}
                            </button>
                          </div>
                        );
                      });
                    })()
                  )}
                </div>
              </div>
            </div>
          </div>
          </ErrorBoundary>
        )}

        {activeTab === 'rules' && (
          <ErrorBoundary name="RulesPanel">
            <RulesPanel
              rules={rules}
              newRuleTitle={newRuleTitle}
              newRuleContent={newRuleContent}
              setNewRuleTitle={setNewRuleTitle}
              setNewRuleContent={setNewRuleContent}
              onAddRule={handleAddRule}
              onDeleteRule={handleDeleteRule}
              onUpdateRule={handleUpdateRule}
              onCopy={copyToClipboard}
              copiedId={copiedId}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'playground' && (
          <ErrorBoundary name="Playground">
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('playground.title')}</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>{t('playground.description')}</p>
              </div>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '14px', padding: '8px 16px' }}
                onClick={() => setChatHistory([])}
                disabled={chatHistory.length === 0}
              >
                {t('playground.clearChat')}
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-secondary)' }}>{t('playground.selectModel')}</span>
                <select
                  className="input"
                  style={{ minWidth: '320px', fontSize: '15px', padding: '8px 12px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                  value={selectedTestModel}
                  onChange={(e) => setSelectedTestModel(e.target.value)}
                  disabled={isChatting}
                >
                  {availableModels.length === 0 ? (
                    <option value="">{t('playground.noModels')}</option>
                  ) : (
                    (() => {
                      const grouped = availableModels.reduce((acc, m) => {
                        const cat = getModelCategory(m.id);
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(m);
                        return acc;
                      }, {});
                      return Object.entries(grouped).sort(([a], [b]) => {
                        if (a === 'Other') return 1;
                        if (b === 'Other') return -1;
                        return a.localeCompare(b);
                      }).map(([cat, items]) => (
                        <optgroup key={cat} label={cat}>
                          {items
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.id.split('/').shift()})
                              </option>
                            ))}
                        </optgroup>
                      ));
                    })()
                  )}
                </select>
                {isChatting && (
                  <span style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={14} className="animate-spin" />
                    {t('playground.streaming')}
                  </span>
                )}
              </div>

              <div style={{
                flex: 1,
                overflowY: 'auto',
                background: 'rgba(0, 0, 0, 0.25)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                {chatHistory.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px' }}>
                    <Cpu size={48} style={{ color: 'var(--border-color)' }} />
                    <span style={{ fontSize: '15px' }}>{t('playground.enterMessage')}</span>
                  </div>
                ) : (
                  chatHistory.map((msg, index) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div
                        key={index}
                        style={{
                          display: 'flex',
                          justifyContent: isUser ? 'flex-end' : 'flex-start',
                          width: '100%'
                        }}
                      >
                        <div style={{
                          maxWidth: '75%',
                          background: isUser ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255,255,255,0.04)',
                          border: isUser ? 'none' : '1px solid var(--border-color)',
                          color: 'white',
                          padding: '12px 16px',
                          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          fontSize: '15px',
                          lineHeight: '1.5',
                          whiteSpace: isUser ? 'pre-wrap' : 'normal',
                          wordBreak: 'break-word',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          userSelect: 'text'
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', opacity: 0.7, display: 'block', marginBottom: '6px' }}>
                            {isUser ? `👤 ${t('playground.userLabel')}` : `🤖 ${t('playground.assistantLabel', { model: selectedTestModel.split('/').pop() })}`}
                          </span>
                          {isUser ? (
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                              {msg.content}
                            </div>
                          ) : (
                            <div className="markdown-body" style={{ fontSize: '14px', lineHeight: '1.6' }}>
                              <MarkdownContent>{msg.content}</MarkdownContent>
                            </div>
                          )}
                          {isChatting && !msg.content && index === chatHistory.length - 1 && 'Thinking...'}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleSendTestMessage} style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder={selectedTestModel ? "Enter message..." : "Sync models first"}
                  className="input"
                  style={{ flex: 1, fontSize: '15px', padding: '12px 16px' }}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={!selectedTestModel || isChatting}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: '0 24px', fontSize: '15px' }}
                  disabled={!selectedTestModel || !chatInput.trim() || isChatting}
                >
                  Send
                </button>
              </form>
            </div>
          </div>
          </ErrorBoundary>
        )}

      </div>

      {isSettingsModalOpen && tempSettings && (
        <div
          onClick={() => setIsSettingsModalOpen(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(2px)'
          }}
        >
          <div
            className="glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '500px',
              maxWidth: '95vw',
              boxSizing: 'border-box',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              maxHeight: '90vh',
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'Outfit' }}>⚙️ {t('settings.title')}</h3>
              <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setIsSettingsModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.nvidiaUrl')}</label>
                <input
                  className="input"
                  type="text"
                  value={tempSettings.NVIDIA_API_URL || ''}
                  onChange={(e) => setTempSettings({ ...tempSettings, NVIDIA_API_URL: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.gatewayPort')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.PORT || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, PORT: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.maxRounds')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.MAX_ROUNDS_PER_MODEL || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, MAX_ROUNDS_PER_MODEL: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.roundDelay')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.ROUND_DELAY_MS || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, ROUND_DELAY_MS: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.requestTimeout')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.REQUEST_TIMEOUT_MS || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, REQUEST_TIMEOUT_MS: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.streamTimeout')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.STREAM_READ_TIMEOUT_MS || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, STREAM_READ_TIMEOUT_MS: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.testTimeout')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.TEST_TIMEOUT_MS || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, TEST_TIMEOUT_MS: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.modelCooldown')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.MODEL_FAILURE_COOLDOWN_MS || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, MODEL_FAILURE_COOLDOWN_MS: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.keyConcurrencyDelay')}</label>
                  <input
                    className="input"
                    type="number"
                    value={tempSettings.KEY_CONCURRENCY_DELAY_MS || ''}
                    onChange={(e) => setTempSettings({ ...tempSettings, KEY_CONCURRENCY_DELAY_MS: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px', fontWeight: '700', color: 'var(--accent-color)', fontSize: '15px' }}>
                💰 {t('settings.pricing')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.promptPrice')}</label>
                  <input className="input" type="number" step="0.01"
                    value={tempSettings.PRICE_PER_MILLION_PROMPT_TOKENS || 0}
                    onChange={(e) => setTempSettings({ ...tempSettings, PRICE_PER_MILLION_PROMPT_TOKENS: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.completionPrice')}</label>
                  <input className="input" type="number" step="0.01"
                    value={tempSettings.PRICE_PER_MILLION_COMPLETION_TOKENS || 0}
                    onChange={(e) => setTempSettings({ ...tempSettings, PRICE_PER_MILLION_COMPLETION_TOKENS: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.currency')}</label>
                  <input className="input" type="text"
                    value={tempSettings.CURRENCY_SYMBOL || 'USD'}
                    onChange={(e) => setTempSettings({ ...tempSettings, CURRENCY_SYMBOL: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ marginTop: '8px', fontWeight: '700', color: 'var(--text-secondary)', fontSize: '14px' }}>
                ⚖️ {t('settings.refPricing')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.refPromptPrice')}</label>
                  <input className="input" type="number" step="0.01"
                    value={tempSettings.REF_PRICE_PER_MILLION_PROMPT_TOKENS || 0}
                    onChange={(e) => setTempSettings({ ...tempSettings, REF_PRICE_PER_MILLION_PROMPT_TOKENS: Number(e.target.value) })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{t('settings.refCompletionPrice')}</label>
                  <input className="input" type="number" step="0.01"
                    value={tempSettings.REF_PRICE_PER_MILLION_COMPLETION_TOKENS || 0}
                    onChange={(e) => setTempSettings({ ...tempSettings, REF_PRICE_PER_MILLION_COMPLETION_TOKENS: Number(e.target.value) })}
                  />
                </div>
              </div>

              {tempSettings.PORT !== settingsData.PORT && (
                <div style={{ fontSize: '12px', color: 'var(--status-cooldown)', marginTop: '4px', fontWeight: '500' }}>
                  ⚠️ {t('settings.portNotice')}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <button className="btn btn-secondary" onClick={() => setIsSettingsModalOpen(false)}>
                {t('settings.cancel')}
              </button>
              <button className="btn btn-primary" onClick={async () => {
                await saveSettings(tempSettings);
                setIsSettingsModalOpen(false);
              }}>
                {t('settings.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
