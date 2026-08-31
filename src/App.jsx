import React, { useState, useEffect } from 'react';
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

export default function App() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isMeihuaHelpModalOpen, setIsMeihuaHelpModalOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState([]);

  const settings = useMobileSettings();

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
  }, []);

  const chat = useMobileChat({
    currentProviderId: settings.currentProviderId,
    currentModelId: settings.currentModelId,
    providerConfigs: settings.providerConfigs,
    selectedSkillIds,
    setSelectedSkillIds
  });

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
            載入中...
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
        onSend={() => chat.sendMessage()}
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
      />

      {/* History Slide-out Drawer */}
      <HistoryDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        conversations={chat.conversations}
        currentConversationId={chat.currentConversationId}
        onSelectConversation={chat.selectConversation}
        onNewChat={chat.newChat}
        onNewMeihuaChat={chat.newMeihuaChat}
        onRenameConversation={chat.renameConversation}
        onDeleteConversation={chat.deleteConversation}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
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
        mcpServers={settings.mcpServers}
        onAddMcpServer={settings.addMcpServer}
        onToggleMcpServer={settings.toggleMcpServer}
        onDeleteMcpServer={settings.deleteMcpServer}
        onSyncMcpServer={settings.syncMcpServer}
        onTestMcpConnection={settings.testMcpConnection}
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
    </div>
  );
}
