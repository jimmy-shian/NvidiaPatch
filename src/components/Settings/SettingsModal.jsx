import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Server, User, Sparkles, Info, ShieldCheck } from 'lucide-react';
import ProviderConfigTab from './ProviderConfigTab';
import PersonalContextTab from './PersonalContextTab';
import SkillsManagerTab from './SkillsManagerTab';

export default function SettingsModal({
  isOpen,
  onClose,
  providerConfigs,
  currentProviderId,
  onChangeProvider,
  onUpdateProviderConfig,
  onTestConnection,
  onSyncModels,
  availableModels,
  contextSettings,
  onUpdateContext,
  skills,
  onImportSkill,
  onSaveSkill,
  onDeleteSkill
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('providers');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 animate-fade-in safe-area-top safe-area-bottom">
      <div className="w-full max-w-lg bg-[#0e1420] border border-slate-800 rounded-3xl h-[90vh] max-h-[720px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#111827]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-emerald-400" size={20} />
            <h3 className="font-bold text-white text-base">{t('settings.title')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800/80 bg-slate-900/60 overflow-x-auto scrollbar-none px-2 pt-1">
          <button
            onClick={() => setActiveTab('providers')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'providers'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server size={14} />
            <span>{t('settings.tabs.providers')}</span>
          </button>

          <button
            onClick={() => setActiveTab('context')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'context'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <User size={14} />
            <span>{t('settings.tabs.context')}</span>
          </button>

          <button
            onClick={() => setActiveTab('skills')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'skills'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles size={14} />
            <span>{t('settings.tabs.skills')}</span>
          </button>

          <button
            onClick={() => setActiveTab('about')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'about'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Info size={14} />
            <span>{t('settings.tabs.about')}</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'providers' && (
            <ProviderConfigTab
              providerConfigs={providerConfigs}
              currentProviderId={currentProviderId}
              onChangeProvider={onChangeProvider}
              onUpdateProviderConfig={onUpdateProviderConfig}
              onTestConnection={onTestConnection}
              onSyncModels={onSyncModels}
              availableModels={availableModels}
            />
          )}

          {activeTab === 'context' && (
            <PersonalContextTab
              contextSettings={contextSettings}
              onUpdateContext={onUpdateContext}
            />
          )}

          {activeTab === 'skills' && (
            <SkillsManagerTab
              skills={skills}
              onImportSkill={onImportSkill}
              onSaveSkill={onSaveSkill}
              onDeleteSkill={onDeleteSkill}
            />
          )}

          {activeTab === 'about' && (
            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white font-extrabold text-xl shadow-lg shadow-emerald-950/50">
                  N
                </div>
                <h4 className="font-bold text-white text-base">{t('settings.about.title')}</h4>
                <p className="text-slate-400 text-xs font-mono">{t('settings.about.version')}</p>
                <p className="text-slate-300 text-xs leading-relaxed max-w-sm mt-1">
                  {t('settings.about.desc')}
                </p>
              </div>

              <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-2">
                <h5 className="font-bold text-white text-xs">隱私與本機優先原則 (Local-First):</h5>
                <ul className="list-disc list-inside text-slate-400 space-y-1 text-[11px] leading-relaxed">
                  <li>完全不依賴外部登入帳號系統。</li>
                  <li>對話紀錄、個人 Context、Skills 僅保存在裝置本地。</li>
                  <li>API Key 使用 Android Keystore 安全加密保存，絕不上傳第三方。</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
