import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import packageJson from '../package.json';
import useGatewayApi from './hooks/useGatewayApi';
import useRealtimeEvents from './hooks/useRealtimeEvents';
import useNotifications from './hooks/useNotifications';
import ErrorBoundary from './components/shared/ErrorBoundary';
import ConfirmationModal from './components/shared/ConfirmationModal';
import RulesPanel from './components/Rules/RulesPanel';
import Sidebar from './components/shared/Sidebar';
import SettingsModal from './components/shared/SettingsModal';
import OverviewPanel from './components/Dashboard/OverviewPanel';
import LogsPanel from './components/Dashboard/LogsPanel';
import TokensPanel from './components/Dashboard/TokensPanel';
import KeysPanel from './components/Keys/KeysPanel';
import ModelsPanel from './components/Models/ModelsPanel';
import PlaygroundPanel from './components/Playground/PlaygroundPanel';

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

  const [dashboardSubTab, setDashboardSubTab] = useState('overview');
  const [currentTimeMs, setCurrentTimeMs] = useState(Date.now());
  const [hoveredHourlyIndex, setHoveredHourlyIndex] = useState(null);

  const [expandedTokenLogId, setExpandedTokenLogId] = useState(null);
  const [expandedTokenLogTabs, setExpandedTokenLogTabs] = useState({});

  const [gatewayHealth, setGatewayHealth] = useState(null);
  const [isRestartingGateway, setIsRestartingGateway] = useState(false);
  const [restartNotice, setRestartNotice] = useState(null);
  const restartNoticeTimerRef = useRef(null);
  const fetchDataPromiseRef = useRef(null);
  const lastFetchStartedAtRef = useRef(0);
  const FETCH_DATA_DEDUPE_MS = 1500;

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    cancelText: '',
    type: 'danger',
    onConfirm: () => {}
  });

  const showConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmModal({
        isOpen: true,
        title: options.title || '',
        message: options.message || '',
        confirmText: options.confirmText || '',
        cancelText: options.cancelText || '',
        type: options.type || 'danger',
        onConfirm: () => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          resolve(true);
        },
        onCancel: () => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          resolve(false);
        }
      });
    });
  }, []);

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

  const fetchData = useCallback(async (options = {}) => {
    if (fetchDataPromiseRef.current) {
      return fetchDataPromiseRef.current;
    }

    const now = Date.now();
    if (!options.force && now - lastFetchStartedAtRef.current < FETCH_DATA_DEDUPE_MS) {
      return Promise.resolve();
    }
    lastFetchStartedAtRef.current = now;

    const runFetch = async () => {
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
      } finally {
        fetchDataPromiseRef.current = null;
      }
    };

    fetchDataPromiseRef.current = runFetch();
    return fetchDataPromiseRef.current;
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
  }, [loginInput, api, t]);

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

  useEffect(() => {
    if (activeTab === 'models' && availableModels.length === 0 && !isSyncingModels) {
      handleSyncModelsSilently();
    }
  }, [activeTab, availableModels.length]);

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

  useEffect(() => {
    if (!sseConnected) {
      setGatewayHealth(null);
    }
  }, [sseConnected]);

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

  const formatModelSyncSummary = ({ parsedCount, savedCount, expectedCount, source }) => {
    const parts = [];
    if (Number.isFinite(Number(parsedCount))) parts.push(`${t('models.parsed')}: ${Number(parsedCount)}`);
    if (Number.isFinite(Number(savedCount))) parts.push(`${t('models.saved')}: ${Number(savedCount)}`);
    if (Number.isFinite(Number(expectedCount))) parts.push(`${t('models.expected')}: ${Number(expectedCount)}`);
    return parts.join(' | ') || t('models.syncComplete');
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
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('keys.deleteConfirm'),
      type: 'danger'
    });
    if (!ok) return;
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

  const handleMovePriority = async (index, direction) => {
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
      fetchData();
    }
  };

  const handleRemoveModelFromPriority = async (modelId) => {
    const order = models.map(m => m.model_id).filter(id => id !== modelId);
    setModels(buildModelsFromOrder(order));
    try {
      await saveModelPriorities(order);
    } catch (err) {
      fetchData();
    }
  };

  const handleAddModelToPriority = async (modelId) => {
    if (models.some(m => m.model_id === modelId)) return;
    const order = [...models.map(m => m.model_id), modelId];
    setModels(buildModelsFromOrder(order));
    try {
      await saveModelPriorities(order);
    } catch (err) {
      fetchData();
    }
  };

  const handleAddRule = async (e) => {
    e.preventDefault();
    if (!newRuleTitle.trim() || !newRuleContent.trim()) return;
    try {
      await api.addRule(newRuleTitle.trim(), newRuleContent.trim());
      setNewRuleTitle('');
      setNewRuleContent('');
      fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Add rule error');
    }
  };

  const handleDeleteRule = async (id) => {
    try {
      await api.deleteRule(id);
      setRules(prev => prev.filter(rule => rule.id !== id));
      fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Delete rule error');
    }
  };

  const handleUpdateRule = async (id, title, content) => {
    try {
      await api.updateRule(id, title, content);
      setRules(prev => prev.map(rule => rule.id === id ? { ...rule, title, content } : rule));
      fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Update rule error');
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
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('common.confirm'),
      type: 'danger'
    });
    if (!ok) return;
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
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('common.confirmRestartGateway'),
      type: 'danger'
    });
    if (!ok) return;
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
  }, [isRestartingGateway, api, checkGatewayHealth, showRestartNotice, fetchData, t, showConfirm]);

  const handleRestartApp = useCallback(async () => {
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('common.confirmRestartApp'),
      type: 'danger'
    });
    if (!ok) return;
    if (window.electronAPI?.restartApp) {
      window.electronAPI.restartApp();
    }
  }, [t, showConfirm]);

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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={stats}
        rulesCount={rules.length}
        gatewayHealth={gatewayHealth}
        isRestartingGateway={isRestartingGateway}
        handleRestartGateway={handleRestartGateway}
        restartNotice={restartNotice}
        theme={theme}
        setTheme={setTheme}
        settingsData={settingsData}
        setTempSettings={setTempSettings}
        setIsSettingsModalOpen={setIsSettingsModalOpen}
        handleRestartApp={handleRestartApp}
        apiError={apiError}
      />

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
                  <span>{t('dashboard.overview')}</span>
                </button>
                <button
                  className={`btn ${dashboardSubTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 14px', fontSize: '14px' }}
                  onClick={() => setDashboardSubTab('logs')}
                >
                  <span>{t('dashboard.logs')}</span>
                </button>
                <button
                  className={`btn ${dashboardSubTab === 'tokens' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 14px', fontSize: '14px' }}
                  onClick={() => setDashboardSubTab('tokens')}
                >
                  <span>{t('dashboard.tokens')}</span>
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>{t('common.sse')}</span>
                <div style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: sseConnected ? 'var(--status-active)' : 'var(--status-inactive)',
                  boxShadow: sseConnected ? '0 0 6px var(--status-active-glow-start)' : 'none'
                }} />
              </div>
            </div>

            {dashboardSubTab === 'overview' && (
              <OverviewPanel
                stats={stats}
                models={models}
                activeModelGroup={activeModelGroup}
                copiedId={copiedId}
                copyToClipboard={copyToClipboard}
                getTotalRequests={getTotalRequests}
                calculateSuccessRate={calculateSuccessRate}
                getGatewayUrl={getGatewayUrl}
                hoveredHourlyIndex={hoveredHourlyIndex}
                setHoveredHourlyIndex={setHoveredHourlyIndex}
              />
            )}

            {dashboardSubTab === 'logs' && (
              <LogsPanel
                logs={logs}
                fetchData={fetchData}
                theme={theme}
              />
            )}

            {dashboardSubTab === 'tokens' && (
              <TokensPanel
                tokenUsageData={tokenUsageData}
                api={api}
                setTokenUsageData={setTokenUsageData}
                clearTokenUsage={clearTokenUsage}
                availableModels={availableModels}
                expandedTokenLogId={expandedTokenLogId}
                setExpandedTokenLogId={setExpandedTokenLogId}
                expandedTokenLogTabs={expandedTokenLogTabs}
                setExpandedTokenLogTabs={setExpandedTokenLogTabs}
              />
            )}
          </div>
        )}

        {activeTab === 'keys' && (
          <KeysPanel
            keys={keys}
            newKey={newKey}
            setNewKey={setNewKey}
            keyTestNotice={keyTestNotice}
            isTestingKeys={isTestingKeys}
            currentTimeMs={currentTimeMs}
            handleTestKeys={handleTestKeys}
            handleAddKey={handleAddKey}
            handleDeleteKey={handleDeleteKey}
          />
        )}

        {activeTab === 'models' && (
          <ModelsPanel
            models={models}
            setModels={setModels}
            modelGroups={modelGroups}
            activeModelGroup={activeModelGroup}
            availableModels={availableModels}
            lastSyncTime={lastSyncTime}
            lastSyncSource={lastSyncSource}
            expectedModelCount={expectedModelCount}
            lastParsedModelCount={lastParsedModelCount}
            lastSavedModelCount={lastSavedModelCount}
            isSyncingModels={isSyncingModels}
            syncNotice={syncNotice}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            handleSyncModels={handleSyncModels}
            handleSwitchModelGroup={handleSwitchModelGroup}
            handleMovePriority={handleMovePriority}
            handleRemoveModelFromPriority={handleRemoveModelFromPriority}
            handleAddModelToPriority={handleAddModelToPriority}
            saveModelPriorities={saveModelPriorities}
            buildModelsFromOrder={buildModelsFromOrder}
          />
        )}

        {activeTab === 'playground' && (
          <PlaygroundPanel
            availableModels={availableModels}
            selectedTestModel={selectedTestModel}
            setSelectedTestModel={setSelectedTestModel}
            chatHistory={chatHistory}
            setChatHistory={setChatHistory}
            chatInput={chatInput}
            setChatInput={setChatInput}
            isChatting={isChatting}
            handleSendTestMessage={handleSendTestMessage}
          />
        )}

        {activeTab === 'rules' && (
          <RulesPanel
            rules={rules}
            newRuleTitle={newRuleTitle}
            setNewRuleTitle={setNewRuleTitle}
            newRuleContent={newRuleContent}
            setNewRuleContent={setNewRuleContent}
            onAddRule={handleAddRule}
            onDeleteRule={handleDeleteRule}
            onUpdateRule={handleUpdateRule}
          />
        )}
      </div>

      <SettingsModal
        isOpen={isSettingsModalOpen}
        tempSettings={tempSettings}
        setTempSettings={setTempSettings}
        settingsData={settingsData}
        setIsSettingsModalOpen={setIsSettingsModalOpen}
        saveSettings={saveSettings}
      />

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={confirmModal.onCancel}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        type={confirmModal.type}
      />
    </div>
  );
}
