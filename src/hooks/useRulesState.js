import { useState, useCallback } from 'react';

export default function useRulesState(api, fetchData, showToast) {
  const [rules, setRules] = useState([]);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleContent, setNewRuleContent] = useState('');

  const loadRules = useCallback(async () => {
    try {
      const data = await api.fetchRules();
      setRules(data || []);
      return data;
    } catch (err) {
      console.error('Failed to load rules:', err);
      return [];
    }
  }, [api]);

  const handleAddRule = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newRuleTitle.trim() || !newRuleContent.trim()) return;
    try {
      await api.addRule(newRuleTitle.trim(), newRuleContent.trim());
      setNewRuleTitle('');
      setNewRuleContent('');
      if (showToast) {
        showToast('success', '已新增自訂規範', 1500);
      }
      if (fetchData) fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      if (showToast) {
        showToast('error', '新增規範失敗：' + err.message, 1500);
      } else {
        alert('Add rule error');
      }
    }
  }, [api, newRuleTitle, newRuleContent, fetchData, showToast]);

  const handleDeleteRule = useCallback(async (id) => {
    try {
      await api.deleteRule(id);
      setRules(prev => prev.filter(rule => rule.id !== id));
      if (showToast) {
        showToast('success', '已刪除規範', 1500);
      }
      if (fetchData) fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      if (showToast) {
        showToast('error', '刪除規範失敗：' + err.message, 1500);
      } else {
        alert('Delete rule error');
      }
    }
  }, [api, fetchData, showToast]);

  const handleUpdateRule = useCallback(async (id, title, content) => {
    try {
      await api.updateRule(id, title, content);
      setRules(prev => prev.map(rule => rule.id === id ? { ...rule, title, content } : rule));
      if (showToast) {
        showToast('success', '已更新規範', 1500);
      }
      if (fetchData) fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      if (showToast) {
        showToast('error', '更新規範失敗：' + err.message, 1500);
      } else {
        alert('Update rule error');
      }
    }
  }, [api, fetchData, showToast]);

  return {
    rules,
    setRules,
    newRuleTitle,
    setNewRuleTitle,
    newRuleContent,
    setNewRuleContent,
    loadRules,
    handleAddRule,
    handleDeleteRule,
    handleUpdateRule
  };
}
