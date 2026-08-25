import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useGatewayApi from './hooks/useGatewayApi';
import useRealtimeEvents from './hooks/useRealtimeEvents';
import useNotifications from './hooks/useNotifications';
import usePlaygroundChat from './hooks/usePlaygroundChat';

import useKeysState from './hooks/useKeysState';
import useModelsState from './hooks/useModelsState';
import useRulesState from './hooks/useRulesState';
import useSettingsState from './hooks/useSettingsState';
import useLogsState from './hooks/useLogsState';
import useStatsState from './hooks/useStatsState';

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
  const { t } = useTranslation();

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

  const [adminToken] = useState('bypass');
  const api = useGatewayApi(GATEWAY_URL, adminToken);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardSubTab, setDashboardSubTab] = useState('overview');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'theme-dark');
  const [currentTimeMs, setCurrentTimeMs] = useState(Date.now());
  const [copiedId, setCopiedId] = useState(null);
  const [apiError, setApiError] = useState('');
  const [gatewayHealth, setGatewayHealth] = useState(null);
  const [gatewayState, setGatewayState] = useState('STOPPED');
  const [isOperatingGateway, setIsOperatingGateway] = useState(false);
  const [restartNotice, setRestartNotice] = useState(null);
  const restartNoticeTimerRef = useRef(null);


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

  const {
    selectedTestModel,
    setSelectedTestModel,
    chatHistory,
    setChatHistory,
    chatInput,
    setChatInput,
    isChatting,
    selectedSkillIds,
    setSelectedSkillIds,
    handleSendTestMessage
  } = usePlaygroundChat(GATEWAY_URL, adminToken);

  const fetchDataPromiseRef = useRef(null);
  const lastFetchStartedAtRef = useRef(0);
  const FETCH_DATA_DEDUPE_MS = 1500;

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
          api.fetchKeys().then(data => keysState.setKeys(data || [])).catch(err => console.error('keys:', err)),
          api.fetchModels().then(data => modelsState.setModels(data || [])).catch(err => console.error('models:', err)),
          api.fetchModelGroups().then(data => {
            modelsState.setActiveModelGroup(data.activeGroup || 1);
            modelsState.setModelGroups(data.groups || []);
          }).catch(err => console.error('modelGroups:', err)),
          api.fetchAvailableModels().then(data => {
            modelsState.setAvailableModels(data.models || []);
            modelsState.setLastSyncTime(data.lastSyncTime || null);
            modelsState.setLastSyncSource(data.lastSyncSource || null);
            modelsState.setExpectedModelCount(data.expectedCount || null);
            modelsState.setLastParsedModelCount(data.parsedCount ?? null);
            modelsState.setLastSavedModelCount(data.savedCount ?? null);
            if (data.models?.length > 0) setSelectedTestModel(prev => prev || data.models[0].id);
          }).catch(err => console.error('availModels:', err)),
          api.fetchRules().then(data => rulesState.setRules(data || [])).catch(err => console.error('rules:', err)),
          api.fetchSettings().then(data => settingsState.setSettingsData(data)).catch(err => console.error('settings:', err)),
          api.fetchTokenUsage().then(data => statsState.setTokenUsageData(data)).catch(err => console.error('tokenUsage:', err)),
          api.fetchLogs().then(data => logsState.setLogs(data || [])).catch(err => console.error('logs:', err)),
          api.fetchStats().then(data => statsState.setStats(data)).catch(err => console.error('stats:', err)),
        ];
        await Promise.all(promises);
        setApiError('');
      } catch (err) {
        if (gatewayState === 'RUNNING') {
          setApiError('Unable to connect to Gateway.');
        } else {
          setApiError('');
        }
      } finally {
        fetchDataPromiseRef.current = null;
      }
    };

    fetchDataPromiseRef.current = runFetch();
    return fetchDataPromiseRef.current;
  }, [api, setSelectedTestModel, gatewayState]);


  // Dedicated modular state hooks
  const keysState = useKeysState(api, fetchData, showConfirm);
  const modelsState = useModelsState(api, fetchData, setSelectedTestModel);
  const rulesState = useRulesState(api, fetchData);
  const settingsState = useSettingsState(api);
  const logsState = useLogsState(api);
  const statsState = useStatsState(api, showConfirm);

  const { notifyAllKeysDown } = useNotifications();

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (restartNoticeTimerRef.current) clearTimeout(restartNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (adminToken) {
      fetchData();
    }
  }, [adminToken, fetchData]);

  useEffect(() => {
    if (activeTab === 'keys') {
      keysState.loadKeys();
    }
  }, [activeTab, keysState.loadKeys]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    if (!window.electronAPI) return;

    if (window.electronAPI.getGatewayState) {
      window.electronAPI.getGatewayState().then(res => {
        if (res && res.state) {
          setGatewayState(res.state);
          if (res.state === 'RUNNING') {
            checkGatewayHealth();
            fetchData({ force: true });
          }
        }
      }).catch(console.error);
    }

    const unsubs = [];
    if (window.electronAPI.onGatewayStateChanged) {
      unsubs.push(window.electronAPI.onGatewayStateChanged((data) => {
        if (data && data.state) {
          setGatewayState(data.state);
          if (data.state === 'RUNNING') {
            checkGatewayHealth();
            fetchData({ force: true });
          } else if (data.state === 'STOPPED') {
            setGatewayHealth(null);
            setApiError('');
          }
        }
      }));
    }

    if (window.electronAPI.onGatewayRestarted) {
      unsubs.push(window.electronAPI.onGatewayRestarted(() => {
        setGatewayState('RUNNING');
        checkGatewayHealth();
        fetchData({ force: true });
      }));
    }

    return () => {
      unsubs.forEach(fn => typeof fn === 'function' && fn());
    };
  }, [checkGatewayHealth, fetchData]);

  useEffect(() => {
    if (keysState.keys.length > 0 && keysState.keys.every(k => k.status === 'inactive' || k.status === 'cooldown')) {
      notifyAllKeysDown();
    }
  }, [keysState.keys, notifyAllKeysDown]);

  const sseConnected = useRealtimeEvents(GATEWAY_URL, adminToken, {
    onLogs: (data) => { logsState.handleSseLog(data); },
    onStats: (data) => { statsState.setStats(data); },
    onKeys: (data) => { if (data.action !== 'test') fetchData(); },
    onModels: () => { fetchData(); },
    onRules: () => { fetchData(); },
    onSettings: (data) => { settingsState.setSettingsData(data); },
    onTokenUsage: () => { statsState.loadTokenUsage(); },
    onHealth: (data) => { setGatewayHealth(data); },
    onReconnect: () => { fetchData(); }
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && adminToken && gatewayState === 'RUNNING') {
        fetchData();
        checkGatewayHealth();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [adminToken, fetchData, checkGatewayHealth, gatewayState]);

  useEffect(() => {
    if (!sseConnected) {
      setGatewayHealth(null);
    }
  }, [sseConnected]);

  const showRestartNotice = useCallback((type, message) => {
    if (restartNoticeTimerRef.current) clearTimeout(restartNoticeTimerRef.current);
    setRestartNotice({ type, message });
    restartNoticeTimerRef.current = setTimeout(() => {
      setRestartNotice(null);
      restartNoticeTimerRef.current = null;
    }, 10000);
  }, []);

  const handleStartGateway = useCallback(async () => {
    if (isOperatingGateway) return;
    setIsOperatingGateway(true);
    showRestartNotice('info', t('gateway.startingNotice'));

    if (window.electronAPI?.startGateway) {
      const res = await window.electronAPI.startGateway();
      if (res?.success) {
        showRestartNotice('success', t('gateway.startedNotice'));
        setGatewayState('RUNNING');
        checkGatewayHealth();
        fetchData({ force: true });
      } else {
        showRestartNotice('error', res?.error || 'Gateway start failed');
      }
    }
    setIsOperatingGateway(false);
  }, [isOperatingGateway, checkGatewayHealth, showRestartNotice, fetchData, t]);

  const handleStopGateway = useCallback(async () => {
    if (isOperatingGateway) return;
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('common.confirmStopGateway'),
      type: 'danger'
    });
    if (!ok) return;

    setIsOperatingGateway(true);
    showRestartNotice('info', t('gateway.stoppingNotice'));

    if (window.electronAPI?.stopGateway) {
      const res = await window.electronAPI.stopGateway();
      if (res?.success) {
        showRestartNotice('success', t('gateway.stoppedNotice'));
        setGatewayState('STOPPED');
        setGatewayHealth(null);
        setApiError('');
      } else {
        showRestartNotice('error', res?.error || 'Gateway stop failed');
      }
    }
    setIsOperatingGateway(false);
  }, [isOperatingGateway, showConfirm, showRestartNotice, t]);

  const handleRestartGateway = useCallback(async () => {
    if (isOperatingGateway) return;
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('common.confirmRestartGateway'),
      type: 'danger'
    });
    if (!ok) return;

    setIsOperatingGateway(true);
    showRestartNotice('info', t('gateway.restartingNotice'));

    try {
      await api.resetCooldowns();
    } catch (_) {}

    if (window.electronAPI?.restartGateway) {
      const res = await window.electronAPI.restartGateway();
      if (res?.success) {
        showRestartNotice('success', t('gateway.restartedNotice'));
        setGatewayState('RUNNING');
        checkGatewayHealth();
        fetchData({ force: true });
      } else {
        showRestartNotice('error', res?.error || 'Gateway restart failed');
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

    setIsOperatingGateway(false);
  }, [isOperatingGateway, api, checkGatewayHealth, showRestartNotice, fetchData, t, showConfirm]);

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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={statsState.stats}
        rulesCount={rulesState.rules.length}
        gatewayHealth={gatewayHealth}
        gatewayState={gatewayState}
        isOperatingGateway={isOperatingGateway}
        handleStartGateway={handleStartGateway}
        handleStopGateway={handleStopGateway}
        handleRestartGateway={handleRestartGateway}
        restartNotice={restartNotice}
        theme={theme}
        setTheme={setTheme}
        settingsData={settingsState.settingsData}
        setTempSettings={settingsState.setTempSettings}
        setIsSettingsModalOpen={settingsState.setIsSettingsModalOpen}
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
                stats={statsState.stats}
                models={modelsState.models}
                activeModelGroup={modelsState.activeModelGroup}
                copiedId={copiedId}
                copyToClipboard={copyToClipboard}
                getTotalRequests={statsState.getTotalRequests}
                calculateSuccessRate={statsState.calculateSuccessRate}
                getGatewayUrl={getGatewayUrl}
                hoveredHourlyIndex={statsState.hoveredHourlyIndex}
                setHoveredHourlyIndex={statsState.setHoveredHourlyIndex}
              />
            )}

            {dashboardSubTab === 'logs' && (
              <LogsPanel
                logs={logsState.logs}
                fetchData={fetchData}
                theme={theme}
              />
            )}

            {dashboardSubTab === 'tokens' && (
              <TokensPanel
                tokenUsageData={statsState.tokenUsageData}
                api={api}
                setTokenUsageData={statsState.setTokenUsageData}
                clearTokenUsage={statsState.clearTokenUsage}
                availableModels={modelsState.availableModels}
                expandedTokenLogId={statsState.expandedTokenLogId}
                setExpandedTokenLogId={statsState.setExpandedTokenLogId}
                expandedTokenLogTabs={statsState.expandedTokenLogTabs}
                setExpandedTokenLogTabs={statsState.setExpandedTokenLogTabs}
              />
            )}
          </div>
        )}

        {activeTab === 'keys' && (
          <KeysPanel
            keys={keysState.keys}
            newKey={keysState.newKey}
            setNewKey={keysState.setNewKey}
            keyTestNotice={keysState.keyTestNotice}
            isTestingKeys={keysState.isTestingKeys}
            currentTimeMs={currentTimeMs}
            handleTestKeys={keysState.handleTestKeys}
            handleAddKey={keysState.handleAddKey}
            handleDeleteKey={keysState.handleDeleteKey}
          />
        )}

        {activeTab === 'models' && (
          <ModelsPanel
            models={modelsState.models}
            setModels={modelsState.setModels}
            modelGroups={modelsState.modelGroups}
            activeModelGroup={modelsState.activeModelGroup}
            availableModels={modelsState.availableModels}
            lastSyncTime={modelsState.lastSyncTime}
            lastSyncSource={modelsState.lastSyncSource}
            expectedModelCount={modelsState.expectedModelCount}
            lastParsedModelCount={modelsState.lastParsedModelCount}
            lastSavedModelCount={modelsState.lastSavedModelCount}
            isSyncingModels={modelsState.isSyncingModels}
            syncNotice={modelsState.syncNotice}
            searchTerm={modelsState.searchTerm}
            setSearchTerm={modelsState.setSearchTerm}
            selectedCategory={modelsState.selectedCategory}
            setSelectedCategory={modelsState.setSelectedCategory}
            handleSyncModels={modelsState.handleSyncModels}
            handleSwitchModelGroup={modelsState.handleSwitchModelGroup}
            handleMovePriority={modelsState.handleMovePriority}
            handleRemoveModelFromPriority={modelsState.handleRemoveModelFromPriority}
            handleAddModelToPriority={modelsState.handleAddModelToPriority}
            saveModelPriorities={modelsState.saveModelPriorities}
            buildModelsFromOrder={modelsState.buildModelsFromOrder}
          />
        )}

        {activeTab === 'playground' && (
          <PlaygroundPanel
            availableModels={modelsState.playgroundModels}
            selectedTestModel={selectedTestModel}
            setSelectedTestModel={setSelectedTestModel}
            chatHistory={chatHistory}
            setChatHistory={setChatHistory}
            chatInput={chatInput}
            setChatInput={setChatInput}
            isChatting={isChatting}
            selectedSkillIds={selectedSkillIds}
            setSelectedSkillIds={setSelectedSkillIds}
            handleSendTestMessage={handleSendTestMessage}
          />
        )}

        {activeTab === 'rules' && (
          <RulesPanel
            rules={rulesState.rules}
            newRuleTitle={rulesState.newRuleTitle}
            setNewRuleTitle={rulesState.setNewRuleTitle}
            newRuleContent={rulesState.newRuleContent}
            setNewRuleContent={rulesState.setNewRuleContent}
            onAddRule={rulesState.handleAddRule}
            onDeleteRule={rulesState.handleDeleteRule}
            onUpdateRule={rulesState.handleUpdateRule}
            onCopy={copyToClipboard}
            copiedId={copiedId}
          />
        )}
      </div>

      <SettingsModal
        isOpen={settingsState.isSettingsModalOpen}
        tempSettings={settingsState.tempSettings}
        setTempSettings={settingsState.setTempSettings}
        settingsData={settingsState.settingsData}
        setIsSettingsModalOpen={settingsState.setIsSettingsModalOpen}
        saveSettings={settingsState.saveSettings}
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
