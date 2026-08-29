import { useState, useCallback } from 'react';

export default function useSettingsState(api) {
  const [settingsData, setSettingsData] = useState({
    ROUND_DELAY_MS: 15,
    REQUEST_TIMEOUT_MS: 120,
    STREAM_READ_TIMEOUT_MS: 120,
    TEST_TIMEOUT_MS: 60,
    MODEL_FAILURE_COOLDOWN_MS: 60,
    KEY_CONCURRENCY_DELAY_MS: 5,
    PORT: 4000,
    MAX_ROUNDS_PER_MODEL: 2,
    MAX_EMPTY_RESPONSE_RETRIES: 3,
    ENABLE_CONTENT_VALIDATION: true,
    PRICE_PER_MILLION_PROMPT_TOKENS: 0.3,
    PRICE_PER_MILLION_COMPLETION_TOKENS: 0.6,
    REF_PRICE_PER_MILLION_PROMPT_TOKENS: 5.0,
    REF_PRICE_PER_MILLION_COMPLETION_TOKENS: 15.0,
    CURRENCY_SYMBOL: 'USD'
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [tempSettings, setTempSettings] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.fetchSettings();
      if (data) setSettingsData(data);
      return data;
    } catch (err) {
      console.error('Failed to load settings:', err);
      return null;
    }
  }, [api]);

  const saveSettings = useCallback(async (updated) => {
    try {
      const data = await api.saveSettings(updated);
      if (data) setSettingsData(data);
      if (window.electronAPI?.notifySettingsUpdated) {
        window.electronAPI.notifySettingsUpdated();
      }
      return data;
    } catch (err) {
      console.error('Failed to save settings:', err);
      throw err;
    }
  }, [api]);

  return {
    settingsData,
    setSettingsData,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    tempSettings,
    setTempSettings,
    loadSettings,
    saveSettings
  };
}
