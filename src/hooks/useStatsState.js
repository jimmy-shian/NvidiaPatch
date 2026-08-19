import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export default function useStatsState(api, showConfirm) {
  const { t } = useTranslation();
  const [stats, setStats] = useState({
    hourly: [],
    keysCount: 0,
    activeKeysCount: 0,
    modelsCount: 0
  });
  const [tokenUsageData, setTokenUsageData] = useState({ stats: [], logs: [] });
  const [hoveredHourlyIndex, setHoveredHourlyIndex] = useState(null);
  const [expandedTokenLogId, setExpandedTokenLogId] = useState(null);
  const [expandedTokenLogTabs, setExpandedTokenLogTabs] = useState({});

  const loadStats = useCallback(async () => {
    try {
      const data = await api.fetchStats();
      if (data) setStats(data);
      return data;
    } catch (err) {
      console.error('Failed to load stats:', err);
      return null;
    }
  }, [api]);

  const loadTokenUsage = useCallback(async () => {
    try {
      const data = await api.fetchTokenUsage();
      if (data) setTokenUsageData(data);
      return data;
    } catch (err) {
      console.error('Failed to load token usage:', err);
      return null;
    }
  }, [api]);

  const clearTokenUsage = useCallback(async () => {
    const ok = await showConfirm({
      title: t('common.confirm'),
      message: t('common.confirm'),
      type: 'danger'
    });
    if (!ok) return;
    try {
      await api.clearTokenUsage();
      const data = await api.fetchTokenUsage();
      if (data) setTokenUsageData(data);
    } catch (err) {
      console.error('Failed to clear token usage:', err);
    }
  }, [api, showConfirm, t]);

  const calculateSuccessRate = useCallback(() => {
    if (!stats.hourly || stats.hourly.length === 0) return '100%';
    const totalRequests = stats.hourly.reduce((acc, curr) => acc + (curr.request_count || 0), 0);
    const totalSuccess = stats.hourly.reduce((acc, curr) => acc + (curr.success_count || 0), 0);
    if (totalRequests === 0) return '100%';
    return `${Math.round((totalSuccess / totalRequests) * 100)}%`;
  }, [stats.hourly]);

  const getTotalRequests = useCallback(() => {
    if (!stats.hourly) return 0;
    return stats.hourly.reduce((acc, curr) => acc + (curr.request_count || 0), 0);
  }, [stats.hourly]);

  return {
    stats,
    setStats,
    tokenUsageData,
    setTokenUsageData,
    hoveredHourlyIndex,
    setHoveredHourlyIndex,
    expandedTokenLogId,
    setExpandedTokenLogId,
    expandedTokenLogTabs,
    setExpandedTokenLogTabs,
    loadStats,
    loadTokenUsage,
    clearTokenUsage,
    calculateSuccessRate,
    getTotalRequests
  };
}
