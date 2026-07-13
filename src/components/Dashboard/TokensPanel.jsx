import React from 'react';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from '../shared/ErrorBoundary';
import TokenDetailRow from './TokenDetailRow';
import { getModelEmoji } from '../../utils/modelMeta';

export default function TokensPanel({
  tokenUsageData,
  api,
  setTokenUsageData,
  clearTokenUsage,
  availableModels,
  expandedTokenLogId,
  setExpandedTokenLogId,
  expandedTokenLogTabs,
  setExpandedTokenLogTabs
}) {
  const { t } = useTranslation();

  const pricing = tokenUsageData.pricing || {};
  const pPrice = Number(pricing.pricePerMillionPromptTokens) || 0;
  const cPrice = Number(pricing.pricePerMillionCompletionTokens) || 0;
  const refPPrice = Number(pricing.refPricePerMillionPromptTokens) || 0;
  const refCPrice = Number(pricing.refPricePerMillionCompletionTokens) || 0;
  const curSym = pricing.currencySymbol || 'USD';

  const totalPromptCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_prompt_tokens / 1_000_000) * pPrice, 0);
  const totalCompletionCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_completion_tokens / 1_000_000) * cPrice, 0);
  const totalActualCost = totalPromptCost + totalCompletionCost;

  const totalRefPromptCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_prompt_tokens / 1_000_000) * refPPrice, 0);
  const totalRefCompletionCost = tokenUsageData.stats.reduce((acc, s) => acc + (s.total_completion_tokens / 1_000_000) * refCPrice, 0);
  const totalRefCost = totalRefPromptCost + totalRefCompletionCost;

  const totalSavings = Math.max(0, totalRefCost - totalActualCost);

  const formatCost = (val) => {
    if (val < 0.01 && val > 0) return `<${(0.01).toFixed(2)}`;
    return val.toFixed(4);
  };

  return (
    <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '16px', fontWeight: '700' }}>📊 {t('dashboard.tokens')}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={() => api.fetchTokenUsage().then(data => setTokenUsageData(data)).catch(() => {})}>
            {t('dashboard.refresh')}
          </button>
          <button className="btn btn-danger" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={clearTokenUsage}>
            {t('dashboard.clear')}
          </button>
        </div>
      </div>

      {tokenUsageData.stats.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('dashboard.actualCost', { symbol: curSym })}</div>
            <div className="token-cost" style={{ fontSize: '18px', fontWeight: '700' }}>{curSym} {formatCost(totalActualCost)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              P: {formatCost(totalPromptCost)} | C: {formatCost(totalCompletionCost)}
            </div>
          </div>
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('dashboard.referenceCost', { symbol: curSym })}</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-secondary)' }}>{curSym} {formatCost(totalRefCost)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {t('dashboard.referenceCostDesc')}
            </div>
          </div>
          <div style={{ background: 'var(--accent-glow)', border: '1px solid var(--accent-color)', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', color: 'var(--accent-color)', marginBottom: '4px', fontWeight: '600' }}>💰 {t('dashboard.savings', { symbol: curSym })}</div>
            <div className="token-cost-total" style={{ fontSize: '20px', fontWeight: '800' }}>{curSym} {formatCost(totalSavings)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-active)', marginTop: '4px', fontWeight: '500' }}>
              {t('dashboard.savingsDesc')}
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', paddingRight: '4px' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-secondary)' }}>{t('dashboard.tokenStats')}</h3>
          {tokenUsageData.stats.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-tertiary)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '14px' }}>
              {t('dashboard.noData')}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <table className="token-usage-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.thModelId')}</th>
                    <th>{t('dashboard.thPrompt')}</th>
                    <th>{t('dashboard.thCompletion')}</th>
                    <th>{t('dashboard.thTotal')}</th>
                    <th>{t('dashboard.thCalls')}</th>
                    <th>{t('dashboard.thCost', { symbol: curSym })}</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenUsageData.stats.map((stat, idx) => {
                    const statCost = (stat.total_prompt_tokens / 1_000_000) * pPrice + (stat.total_completion_tokens / 1_000_000) * cPrice;
                    return (
                      <tr key={idx}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{getModelEmoji(stat.model_id)}</span>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: '600' }}>{stat.model_id}</span>
                          </div>
                        </td>
                        <td>{stat.total_prompt_tokens.toLocaleString()}</td>
                        <td>{stat.total_completion_tokens.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{stat.total_total_tokens.toLocaleString()}</td>
                        <td>{stat.request_count}</td>
                        <td className="token-cost">{formatCost(statCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '350px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', color: 'var(--text-secondary)' }}>
            {t('dashboard.tokenDetails')}
            <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-muted)', marginLeft: '8px' }}>
              {t('dashboard.tokenHelp')}
            </span>
          </h3>
          {tokenUsageData.logs.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-tertiary)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '14px', flex: 1 }}>
              {t('dashboard.noRecords')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="token-log-header">
                <span>{t('dashboard.time')}</span>
                <span>{t('dashboard.requestId')}</span>
                <span>{t('dashboard.tokenModel')}</span>
                <span>{t('dashboard.prompt')}</span>
                <span>{t('dashboard.completion')}</span>
                <span>{t('dashboard.total')}</span>
                <span style={{ textAlign: 'right', paddingRight: '4px' }}>{t('dashboard.cost')}</span>
              </div>

              {tokenUsageData.logs.map((log, idx) => (
                <TokenDetailRow
                  key={log.id || idx}
                  log={log}
                  idx={idx}
                  pPrice={pPrice}
                  cPrice={cPrice}
                  refPPrice={refPPrice}
                  refCPrice={refCPrice}
                  curSym={curSym}
                  formatCost={formatCost}
                  availableModels={availableModels}
                  expandedTokenLogId={expandedTokenLogId}
                  setExpandedTokenLogId={setExpandedTokenLogId}
                  expandedTokenLogTabs={expandedTokenLogTabs}
                  setExpandedTokenLogTabs={setExpandedTokenLogTabs}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
