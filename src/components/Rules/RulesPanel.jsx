import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash, Edit3, Save, X as XIcon, Eye } from 'lucide-react';
import MarkdownContent from '../shared/MarkdownContent';
import ErrorBoundary from '../shared/ErrorBoundary';

export default function RulesPanel({
  rules,
  newRuleTitle,
  newRuleContent,
  setNewRuleTitle,
  setNewRuleContent,
  onAddRule,
  onDeleteRule,
  onUpdateRule,
  onCopy,
  copiedId
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [showPreview, setShowPreview] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const startEdit = (rule) => {
    if (rule.is_preset) return;
    setEditingId(rule.id);
    setEditTitle(rule.title);
    setEditContent(rule.content);
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
    setSaveError(null);
  };

  const saveEdit = async (id) => {
    try {
      await onUpdateRule(id, editTitle.trim(), editContent.trim());
      setEditingId(null);
      setSaveError(null);
    } catch (err) {
      setSaveError(err.message);
    }
  };

  return (
    <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('rules.title')}</h2>
          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>{t('rules.description')}</p>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: '20px', overflow: 'hidden' }}>
        <div style={{ flex: 1.5, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '4px' }}>
          {rules.map((r) => (
            <div key={r.id} className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={`badge ${r.is_preset ? 'badge-active' : 'badge-cooldown'}`}>
                    {r.is_preset ? t('rules.preset') : t('rules.custom')}
                  </span>
                  {editingId === r.id ? (
                    <input
                      className="input"
                      style={{ fontSize: '16px', fontWeight: '700' }}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  ) : (
                    <h3 style={{ fontSize: '16px', fontWeight: '700' }}>{r.title}</h3>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {editingId === r.id ? (
                    <>
                      <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '14px' }} onClick={() => saveEdit(r.id)}>
                        <Save size={12} /><span>{t('rules.save')}</span>
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '14px' }} onClick={cancelEdit}>
                        <XIcon size={12} /><span>{t('rules.cancel')}</span>
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 8px', fontSize: '14px' }}
                        onClick={() => setShowPreview(showPreview === r.id ? null : r.id)}
                        title={t('rules.markdownPreview')}
                      >
                        <Eye size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '14px' }} onClick={() => onCopy(r.content, r.id)}>
                        {copiedId === r.id ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedId === r.id ? t('rules.copied') : t('rules.copy')}</span>
                      </button>
                      {!r.is_preset && (
                        <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => startEdit(r)} title={t('rules.edit')}>
                          <Edit3 size={12} />
                        </button>
                      )}
                      {!r.is_preset && (
                        <button className="btn btn-danger" style={{ padding: '6px' }} onClick={() => onDeleteRule(r.id)}>
                          <Trash size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {saveError && editingId === r.id && (
                <div className="sync-notice sync-notice-error" style={{ fontSize: '13px' }}>{saveError}</div>
              )}
              <ErrorBoundary name="RulesMarkdown">
                {editingId === r.id ? (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <textarea
                      className="input"
                      rows="10"
                      style={{ flex: 1, resize: 'vertical', fontFamily: 'monospace', fontSize: '14px' }}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                    />
                    {showPreview === r.id && (
                      <div
                        className="markdown-body"
                        style={{
                          flex: 1,
                          background: 'rgba(0,0,0,0.3)',
                          padding: '12px',
                          borderRadius: '6px',
                          fontSize: '14px',
                          border: '1px solid rgba(255,255,255,0.03)',
                          color: 'var(--text-secondary)',
                          lineHeight: '1.6',
                          maxHeight: '300px',
                          overflowY: 'auto'
                        }}
                      >
                        <MarkdownContent>{editContent}</MarkdownContent>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="markdown-body"
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      padding: '12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      border: '1px solid rgba(255,255,255,0.03)',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.6',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      whiteSpace: 'normal'
                    }}
                  >
                    <MarkdownContent>{r.content}</MarkdownContent>
                  </div>
                )}
              </ErrorBoundary>
            </div>
          ))}
        </div>

        <div className="glass-panel" style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: 'fit-content' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700' }}>+ {t('rules.addTitle')}</h3>
          <form onSubmit={onAddRule} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('rules.titleLabel')}</label>
              <input type="text" placeholder={t('rules.titlePlaceholder')} className="input" value={newRuleTitle} onChange={(e) => setNewRuleTitle(e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('rules.contentLabel')}</label>
              <textarea placeholder={t('rules.contentPlaceholder')} className="input" rows="10" style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '14px' }} value={newRuleContent} onChange={(e) => setNewRuleContent(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: '4px' }}>
              <span>+ {t('rules.addButton')}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}