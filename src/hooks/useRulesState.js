import { useState, useCallback } from 'react';

export default function useRulesState(api, fetchData) {
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
      if (fetchData) fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Add rule error');
    }
  }, [api, newRuleTitle, newRuleContent, fetchData]);

  const handleDeleteRule = useCallback(async (id) => {
    try {
      await api.deleteRule(id);
      setRules(prev => prev.filter(rule => rule.id !== id));
      if (fetchData) fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Delete rule error');
    }
  }, [api, fetchData]);

  const handleUpdateRule = useCallback(async (id, title, content) => {
    try {
      await api.updateRule(id, title, content);
      setRules(prev => prev.map(rule => rule.id === id ? { ...rule, title, content } : rule));
      if (fetchData) fetchData({ force: true });
      if (window.electronAPI?.notifyRulesUpdated) {
        window.electronAPI.notifyRulesUpdated();
      }
    } catch (err) {
      alert('Update rule error');
    }
  }, [api, fetchData]);

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
