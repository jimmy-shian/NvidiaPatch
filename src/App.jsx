import SplashAd from './components/Common/SplashAd';
import StudioAnnouncementOverlay from './components/Common/StudioAnnouncementOverlay';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useMobileSettings } from './hooks/useMobileSettings';
import { useMobileChat } from './hooks/useMobileChat';
import ChatView from './components/Chat/ChatView';
import HistoryDrawer from './components/Drawer/HistoryDrawer';
import ModelSelectorModal from './components/Chat/ModelSelectorModal';
import SettingsModal from './components/Settings/SettingsModal';
import MCPApprovalModal from './components/Chat/MCPApprovalModal';
import MRTRInputModal from './components/Chat/MRTRInputModal';
import MeihuaHelpModal from './components/Chat/MeihuaHelpModal';
import { LocalDB } from './core/storage/localDatabase';
import { PROVIDER_TYPES } from './core/providers';
import { NotificationService } from './core/notifications/notificationService';
import { checkPendingSharedText } from './core/utils/shareTarget';
import { useScheduledTasks } from './hooks/useScheduledTasks';
import { syncPendingNativeTaskResults } from './core/schedule/scheduleEngine';

export default function App() {
  const { t } = useTranslation();
  const [showSplashAd, setShowSplashAd] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('chats');
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isMeihuaHelpModalOpen, setIsMeihuaHelpModalOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState([]);

  const settings = useMobileSettings();

  const chat = useMobileChat({
    currentProviderId: settings.currentProviderId,
    currentModelId: settings.currentModelId,
    providerConfigs: settings.providerConfigs,
    selectedSkillIds,
    setSelectedSkillIds
  });

  const scheduledTasks = useScheduledTasks({
    providerConfigs: settings.providerConfigs,
    skills: settings.skills,
    onSimulateChat: chat.simulateUserChat,
    onCloseDrawer: () => setIsDrawerOpen(false),
    isReady: !settings.isLoading
  });

  const navigateToTarget = useCallback(async ({ conversationId = null, taskId = null, source = null } = {}) => {
    let convId = (conversationId && conversationId !== 'null' && conversationId !== 'undefined')
      ? String(conversationId).trim()
      : null;
    const tId = (taskId && taskId !== 'null' && taskId !== 'undefined')
      ? String(taskId).trim()
      : null;

    if (!convId && !tId) {
      if (source === 'widget') {
        setShowSplashAd(false);
        setIsModelModalOpen(false);
        setIsSettingsModalOpen(false);
        setIsMeihuaHelpModalOpen(false);
        setDrawerTab('schedule');
        setIsDrawerOpen(true);
      }
      return;
    }

    setShowSplashAd(false);
    setIsModelModalOpen(false);
    setIsSettingsModalOpen(false);
    setIsMeihuaHelpModalOpen(false);

    await syncPendingNativeTaskResults();
    const refreshedTasks = await scheduledTasks.loadTasks();

    if (tId) {
      if (scheduledTasks.selectedWidgetTaskId !== tId) {
        await scheduledTasks.selectTaskForWidget(tId);
      }
      if (!convId) {
        const matchedTask = (refreshedTasks || []).find(t => t.id === tId) || (await LocalDB.getScheduledTask(tId));
        if (matchedTask?.conversationId) {
          convId = matchedTask.conversationId;
        }
      }
    }

    if (convId) {
      const dbConv = await LocalDB.getConversation(convId);
      if (dbConv && chat.selectConversation) {
        setIsDrawerOpen(false);
        setHighlightedTaskId(null);
        await chat.selectConversation(convId, { forceReload: true });
        return;
      }
    }

    setHighlightedTaskId(tId);
    setDrawerTab('schedule');
    setIsDrawerOpen(true);
  }, [chat.selectConversation, scheduledTasks.loadTasks, scheduledTasks.selectTaskForWidget, scheduledTasks.selectedWidgetTaskId]);

  const navigateToTargetRef = useRef(navigateToTarget);
  navigateToTargetRef.current = navigateToTarget;

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      try {
        StatusBar.setStyle({ style: Style.Dark });
        StatusBar.setBackgroundColor({ color: '#0b0f17' });
        StatusBar.setOverlaysWebView({ overlay: false });
      } catch (e) {
        console.warn('StatusBar initialization:', e);
      }
    }

    // Request notification permission and initialize listener
    NotificationService.requestPermission();
  }, []);

  useEffect(() => {
    NotificationService.initActionListener((conversationId, taskId) => {
      navigateToTargetRef.current?.({ conversationId, taskId, source: 'notification' });
    });
  }, []);

  // Handle external text shared into NvidiaPatch (Share Target)
  useEffect(() => {
    const handleCheckShared = () => {
      const shared = checkPendingSharedText();
      if (shared) {
        if (typeof chat.newChat === 'function') {
          chat.newChat();
        }
        if (typeof chat.setInput === 'function') {
          chat.setInput(shared);
        }
      }
    };

    handleCheckShared();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleCheckShared();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleCheckShared);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleCheckShared);
    };
  }, [chat.newChat, chat.setInput]);

  // Handle desktop widget / native notification click to open specific conversation or schedule tab
  useEffect(() => {
    if (settings.isLoading || !chat.isConversationsLoaded) return;

    const handleCheckWidgetConv = () => {
      if (typeof window === 'undefined' || !window.NativeStreamBridge) return;

      if (typeof window.NativeStreamBridge.getPendingNavigationTarget === 'function') {
        try {
          const raw = window.NativeStreamBridge.getPendingNavigationTarget();
          if (raw && raw.trim() && raw.trim() !== '{}') {
            const parsed = JSON.parse(raw);
            if (parsed.conversationId || parsed.taskId || parsed.source) {
              navigateToTargetRef.current?.(parsed);
              return;
            }
          }
        } catch (e) {
          console.warn('[App] Parse pending navigation target failed:', e);
        }
      }

      if (typeof window.NativeStreamBridge.getPendingConversationId === 'function') {
        const convId = window.NativeStreamBridge.getPendingConversationId();
        if (convId && convId !== 'null' && convId !== 'undefined') {
          navigateToTargetRef.current?.({ conversationId: convId, source: 'widget' });
        }
      }
    };

    handleCheckWidgetConv();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleCheckWidgetConv();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleCheckWidgetConv);
    window.addEventListener('nativeNavigationIntent', handleCheckWidgetConv);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleCheckWidgetConv);
      window.removeEventListener('nativeNavigationIntent', handleCheckWidgetConv);
    };
  }, [settings.isLoading, chat.isConversationsLoaded]);

  const toggleSkill = (skillId) => {
    setSelectedSkillIds(prev => {
      const next = prev.includes(skillId) ? prev.filter(id => id !== skillId) : [...prev, skillId];
      if (chat.currentConversationId) {
        LocalDB.getConversation(chat.currentConversationId).then(conv => {
          if (conv) {
            LocalDB.saveConversation({ ...conv, skillIds: next });
          }
        });
      }
      return next;
    });
  };

  const currentProviderObj = PROVIDER_TYPES.find(p => p.id === settings.currentProviderId);
  const currentProviderName = currentProviderObj ? currentProviderObj.name : 'NVIDIA NIM';

  const currentConv = chat.conversations.find(c => c.id === chat.currentConversationId);

  if (settings.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-[#0b0f17] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-400 font-sans tracking-wide">
            {t('app.loading', '載入中...')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#0b0f17] overflow-hidden flex flex-col font-sans">
      {/* Main Chat Interface */}
      <ChatView
        conversation={currentConv}
        messages={chat.messages}
        input={chat.input}
        setInput={chat.setInput}
        isStreaming={chat.isStreaming}
        isReasoningActive={chat.isReasoningActive}
        isCompressing={chat.isCompressing}
        liveStatus={chat.liveStatus}
        contextStats={chat.contextStats}
        compressionToast={chat.compressionToast}
        onCompressContext={chat.compressContext}
        onSend={(customText) => chat.sendMessage(customText)}
        onStop={chat.stopGeneration}
        onRegenerate={chat.regenerate}
        onDeleteMessage={chat.deleteMessage}
        onEditMessage={chat.editMessage}
        currentProviderName={currentProviderName}
        currentModelId={settings.currentModelId}
        onOpenModelSelector={() => setIsModelModalOpen(true)}
        onOpenDrawer={() => setIsDrawerOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        availableSkills={settings.skills}
        selectedSkillIds={selectedSkillIds}
        onToggleSkill={toggleSkill}
        conversationType={currentConv?.type}
        onRandomCast={() => {
          const n1 = Math.floor(Math.random() * 999) + 1;
          const n2 = Math.floor(Math.random() * 999) + 1;
          const n3 = Math.floor(Math.random() * 999) + 1;
          // 移除前次數值自傳並使用特殊包裹元素
          chat.setInput(prev => {
            const clean = prev.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>|（靈動數[^）]*）|\[靈動數[^\]]*\]/gi, '').trim();
            return `<meihua-numbers n1="${n1}" n2="${n2}" n3="${n3}"></meihua-numbers> ${clean}`.trimEnd();
          });
        }}
        onShowHelp={() => setIsMeihuaHelpModalOpen(true)}
        attachedImages={chat.attachedImages}
        onAddImages={chat.addImages}
        onRemoveImage={chat.removeImage}
        onClearImages={chat.clearImages}
      />

      {/* History Slide-out Drawer */}
      <HistoryDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setHighlightedTaskId(null);
        }}
        conversations={chat.conversations}
        currentConversationId={chat.currentConversationId}
        onSelectConversation={chat.selectConversation}
        onNewChat={chat.newChat}
        onNewMeihuaChat={chat.newMeihuaChat}
        onRenameConversation={chat.renameConversation}
        onDeleteConversation={chat.deleteConversation}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        providerConfigs={settings.providerConfigs}
        skills={settings.skills}
        currentProviderId={settings.currentProviderId}
        currentModelId={settings.currentModelId}
        scheduledTasks={scheduledTasks}
        drawerTab={drawerTab}
        onDrawerTabChange={setDrawerTab}
        highlightedTaskId={highlightedTaskId}
      />

      {/* Quick Model Selector Bottom Sheet */}
      <ModelSelectorModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        currentProviderId={settings.currentProviderId}
        currentModelId={settings.currentModelId}
        availableModels={settings.availableModels}
        onSelectModel={settings.selectModel}
        onSyncModels={() => settings.syncModels(settings.currentProviderId)}
        isSyncing={settings.isSyncing}
      />

      {/* Full Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        providerConfigs={settings.providerConfigs}
        currentProviderId={settings.currentProviderId}
        onChangeProvider={settings.changeProvider}
        onUpdateProviderConfig={settings.updateProviderConfig}
        onTestConnection={settings.testConnection}
        onSyncModels={settings.syncModels}
        availableModels={settings.availableModels}
        contextSettings={settings.contextSettings}
        onUpdateContext={settings.updateContext}
        skills={settings.skills}
        onImportSkill={settings.importSkill}
        onSaveSkill={settings.saveSkill}
        onDeleteSkill={settings.deleteSkill}
        onReorderSkills={settings.reorderSkills}
        mcpServers={settings.mcpServers}

        onAddMcpServer={settings.addMcpServer}
        onToggleMcpServer={settings.toggleMcpServer}
        onDeleteMcpServer={settings.deleteMcpServer}
        onSyncMcpServer={settings.syncMcpServer}
        onTestMcpConnection={settings.testMcpConnection}
        workerSearchConfig={settings.workerSearchConfig}
        onUpdateWorkerSearchConfig={settings.updateWorkerSearchConfig}
        onTestWorkerSearchConnection={settings.testWorkerSearchConnection}
      />


      {/* Interactive MCP Security Approval Modal */}
      <MCPApprovalModal />

      {/* Interactive MRTR Parameter Elicitation Modal */}
      <MRTRInputModal />

      {/* Interactive Meihua Divination Guide Modal */}
      <MeihuaHelpModal
        isOpen={isMeihuaHelpModalOpen}
        onClose={() => setIsMeihuaHelpModalOpen(false)}
      />

      {/* yesolve studio 開場廣告覆蓋層（翡翠綠神經運算主題） */}
      {showSplashAd && <SplashAd onFinish={() => setShowSplashAd(false)} appName="NvidiaPatch AI" />}
      <StudioAnnouncementOverlay appId="nvidiapatch" blocked={showSplashAd} />
    </div>
  );
}
