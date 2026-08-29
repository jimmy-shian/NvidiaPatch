import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export default function useKeysState(api, fetchData, showConfirm, showToast) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [isTestingKeys, setIsTestingKeys] = useState(false);
  const [keyTestNotice, setKeyTestNotice] = useState(null);
  const keyTestNoticeTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (keyTestNoticeTimerRef.current) clearTimeout(keyTestNoticeTimerRef.current);
    };
  }, []);

  const showKeyTestNotice = useCallback((type, message) => {
    if (keyTestNoticeTimerRef.current) clearTimeout(keyTestNoticeTimerRef.current);
    setKeyTestNotice({ type, message, createdAt: Date.now() });
    if (showToast) {
      showToast(type, message, 1500);
    }
    keyTestNoticeTimerRef.current = setTimeout(() => {
      setKeyTestNotice(null);
      keyTestNoticeTimerRef.current = null;
    }, 1500);
  }, [showToast]);

  const loadKeys = useCallback(async () => {
    try {
      const data = await api.fetchKeys();
      setKeys(data || []);
      return data;
    } catch (err) {
      console.error('Failed to load keys:', err);
      return [];
    }
  }, [api]);

  const handleAddKey = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newKey.trim()) return;
    try {
      await api.addKey(newKey.trim());
      setNewKey('');
      if (showToast) {
        showToast('success', t('keys.addSuccess') || '已成功新增 API Key', 1500);
      }
      if (fetchData) fetchData();
    } catch (err) {
      const msg = t('keys.addFailed', { error: err.message });
      if (showToast) {
        showToast('error', msg, 1500);
      } else {
        alert(msg);
      }
    }
  }, [api, newKey, fetchData, showToast, t]);

  const handleDeleteKey = useCallback(async (id) => {
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('keys.deleteConfirm'),
      type: 'danger'
    });
    if (!ok) return;
    try {
      await api.deleteKey(id);
      if (showToast) {
        showToast('success', t('keys.deleteSuccess') || '已成功刪除 API Key', 1500);
      }
      if (fetchData) fetchData();
    } catch (err) {
      if (showToast) {
        showToast('error', '刪除金鑰失敗：' + err.message, 1500);
      } else {
        alert('Delete key error');
      }
    }
  }, [api, showConfirm, fetchData, showToast, t]);

  const handleTestKeys = useCallback(async () => {
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
      if (fetchData) fetchData();
    } catch (err) {
      showKeyTestNotice('error', `Test error: ${err.message}`);
    } finally {
      setIsTestingKeys(false);
    }
  }, [api, showKeyTestNotice, fetchData, t]);

  return {
    keys,
    setKeys,
    newKey,
    setNewKey,
    isTestingKeys,
    keyTestNotice,
    loadKeys,
    handleAddKey,
    handleDeleteKey,
    handleTestKeys,
    showKeyTestNotice
  };
}
