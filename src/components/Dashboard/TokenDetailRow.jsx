import React from 'react';
import { useTranslation } from 'react-i18next';
import { getModelEmoji } from '../../utils/modelMeta';
import { formatTaiwanTime } from '../../utils/formatting';

export default function TokenDetailRow({
  log,
  idx,
  pPrice,
  cPrice,
  refPPrice,
  refCPrice,
  curSym,
  formatCost,
  availableModels,
  expandedTokenLogId,
  setExpandedTokenLogId,
  expandedTokenLogTabs,
  setExpandedTokenLogTabs
}) {
  const { t } = useTranslation();
  const isExpanded = expandedTokenLogId === log.id;
  const activeDetailTab = expandedTokenLogTabs[log.id] || 'metadata';
  const logCost = (log.prompt_tokens / 1_000_000) * pPrice + (log.completion_tokens / 1_000_000) * cPrice;
  const modelInfo = availableModels.find(m => m.id === log.model_id);

  const handleFieldClick = (fieldTab) => {
    const isCurrentlyExpanded = expandedTokenLogId === log.id;
    const currentTab = expandedTokenLogTabs[log.id];
    if (isCurrentlyExpanded && currentTab === fieldTab) {
      setExpandedTokenLogId(null);
    } else {
      setExpandedTokenLogId(log.id);
      setExpandedTokenLogTabs({
        ...expandedTokenLogTabs,
        [log.id]: fieldTab
      });
    }
  };

  return (
    <div style={{ marginBottom: '2px' }}>
      <div
        className={isExpanded ? 'token-row-expanded' : ''}
        style={{
          display: 'grid',
          gridTemplateColumns: '72px 70px 1fr 70px 90px 70px 80px',
          gap: '0',
          alignItems: 'center',
          padding: '10px 11px',
          background: isExpanded ? 'var(--bg-active)' : 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderTop: 'none',
          cursor: 'pointer',
          fontSize: '13px',
          transition: 'background 150ms ease'
        }}
      >
        <span onClick={() => handleFieldClick('raw')} style={{ color: 'var(--text-muted)' }}>
          {formatTaiwanTime(log.timestamp)}
        </span>
        <span onClick={() => handleFieldClick('raw')} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
          #{log.request_id || 'test'}
        </span>
        <span onClick={() => handleFieldClick('model')} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }} title={t('common.clickForModelCard')}>
          <span>{getModelEmoji(log.model_id)}</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
            {log.model_id.split('/').pop()}
          </span>
        </span>
        <span onClick={() => handleFieldClick('metadata')} style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }} title={t('common.clickForMetadata')}>
          {log.prompt_tokens.toLocaleString()}
        </span>
        <span onClick={() => handleFieldClick('metadata')} style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }} title="Click for metadata">
          {log.completion_tokens.toLocaleString()}
        </span>
        <span onClick={() => handleFieldClick('metadata')} style={{ fontWeight: '700', color: 'var(--accent-color)', textDecoration: 'underline', textDecorationStyle: 'dotted' }} title="Click for metadata">
          {log.total_tokens.toLocaleString()}
        </span>
        <span onClick={() => handleFieldClick('raw')} className="token-cost" style={{ textAlign: 'right', fontSize: '12px' }}>
          {formatCost(logCost)}
        </span>
      </div>

      {isExpanded && (
        <div className="token-detail-panel" style={{ padding: '16px' }}>
          <div className="token-detail-tabs">
            <div
              className={`token-detail-tab ${activeDetailTab === 'metadata' ? 'active' : ''}`}
              onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'metadata' })}
            >
              📋 Metadata
            </div>
            <div
              className={`token-detail-tab ${activeDetailTab === 'prompts' ? 'active' : ''}`}
              onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'prompts' })}
            >
              {t('dashboard.tabPrompts')}
            </div>
            <div
              className={`token-detail-tab ${activeDetailTab === 'model' ? 'active' : ''}`}
              onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'model' })}
            >
              🎴 Model Card
            </div>
            <div
              className={`token-detail-tab ${activeDetailTab === 'raw' ? 'active' : ''}`}
              onClick={() => setExpandedTokenLogTabs({ ...expandedTokenLogTabs, [log.id]: 'raw' })}
            >
              ⚙️ Raw JSON
            </div>
          </div>

          {activeDetailTab === 'metadata' && (
            <pre style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '12px',
              overflow: 'auto',
              maxHeight: '300px'
            }}>
              {JSON.stringify({
                model_id: log.model_id,
                prompt_tokens: log.prompt_tokens,
                completion_tokens: log.completion_tokens,
                total_tokens: log.total_tokens,
                request_id: log.request_id,
                timestamp: log.timestamp,
                metadata: log.metadata || null
              }, null, 2)}
            </pre>
          )}

          {activeDetailTab === 'prompts' && (
            <div className="token-chat-container">
              {(() => {
                try {
                  const renderContent = (content) => {
                    if (content === null || content === undefined) return '';
                    if (typeof content === 'string') return content;
                    if (Array.isArray(content)) {
                      return content.map((item) => {
                        if (typeof item === 'string') return item;
                        if (item && typeof item === 'object') {
                          if (item.type === 'text') return item.text || '';
                          return item.text || JSON.stringify(item);
                        }
                        return String(item);
                      }).join('\n');
                    }
                    if (typeof content === 'object') {
                      return content.text || JSON.stringify(content);
                    }
                    return String(content);
                  };

                  const chatItems = [];

                  let parsed = null;
                  if (typeof log.request_body === 'string') {
                    parsed = JSON.parse(log.request_body);
                  } else {
                    parsed = log.request_body;
                  }
                  let messages = null;
                  if (parsed) {
                    if (Array.isArray(parsed)) {
                      messages = parsed;
                    } else if (Array.isArray(parsed.messages)) {
                      messages = parsed.messages;
                    }
                  }
                  if (Array.isArray(messages)) {
                    messages.forEach((m) => {
                      chatItems.push({ role: m.role || 'unknown', content: renderContent(m.content) });
                    });
                  }

                  const output = log.response_content;
                  if (output) {
                    chatItems.push({ role: 'assistant', content: renderContent(output) });
                  }

                  if (chatItems.length === 0) {
                    return <div style={{ color: 'var(--text-muted)' }}>{t('dashboard.noInputData')}</div>;
                  }

                  return chatItems.map((item, idx) => {
                    const isUser = item.role === 'user';
                    const isAssistant = item.role === 'assistant';
                    const isTool = item.role === 'tool';
                    const bubbleClass = isUser ? 'user' : (isAssistant ? 'assistant' : (isTool ? 'tool' : 'system'));
                    return (
                      <div key={idx} className={`token-chat-message ${bubbleClass}`}>
                        <div className="token-chat-role">{item.role}</div>
                        <pre className="token-chat-content">{item.content}</pre>
                      </div>
                    );
                  });
                } catch (_) {
                  return <div style={{ color: 'var(--text-muted)' }}>{t('dashboard.noInputData')}</div>;
                }
              })()}
            </div>
          )}

          {activeDetailTab === 'model' && (
            <div className="token-model-card">
              <div className="token-model-card-icon" style={{ background: 'var(--bg-active)' }}>
                {getModelEmoji(log.model_id)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {modelInfo?.name || log.model_id.split('/').pop()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: '2px' }}>
                  {log.model_id}
                </div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>NIM: Prompt <strong>${pPrice}</strong> / Completion <strong>${cPrice}</strong> (per M)</span>
                  <span style={{ color: 'var(--text-muted)' }}>Ref: Prompt <strong>${refPPrice}</strong> / Completion <strong>${refCPrice}</strong> (per M)</span>
                </div>
              </div>
            </div>
          )}

          {activeDetailTab === 'raw' && (
            <div>
              <pre style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                overflow: 'auto',
                maxHeight: '300px'
              }}>
                {JSON.stringify(log, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
