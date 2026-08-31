import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import ErrorBoundary from '../shared/ErrorBoundary';
import MarkdownContent from '../shared/MarkdownContent';
import { DIVINATION_SKILLS } from './divinationSkills';
import { getModelCategory } from '../../utils/modelMeta';

export default function PlaygroundPanel({
  availableModels,
  selectedTestModel,
  setSelectedTestModel,
  chatHistory,
  setChatHistory,
  chatInput,
  setChatInput,
  isChatting,
  selectedSkillIds,
  setSelectedSkillIds,
  handleSendTestMessage
}) {
  const { t } = useTranslation();
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const [expandedThinkIds, setExpandedThinkIds] = useState(new Set());

  const toggleThink = (index) => {
    setExpandedThinkIds(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatting]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const computed = getComputedStyle(textarea);
    let lineHeight = parseFloat(computed.lineHeight);
    if (Number.isNaN(lineHeight)) {
      lineHeight = parseFloat(computed.fontSize) * 1.2;
    }
    const paddingTop = parseFloat(computed.paddingTop);
    const paddingBottom = parseFloat(computed.paddingBottom);
    const maxHeight = lineHeight * 4 + paddingTop + paddingBottom;
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
  }, [chatInput]);

  return (
    <ErrorBoundary name="Playground">
      <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('playground.title')}</h2>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>{t('playground.description')}</p>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '14px', padding: '8px 16px' }}
            onClick={() => setChatHistory([])}
            disabled={chatHistory.length === 0}
          >
            {t('playground.clearChat')}
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-secondary)' }}>{t('playground.selectModel')}</span>
            <select
              className="input"
              style={{ minWidth: '320px', fontSize: '15px', padding: '8px 12px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer' }}
              value={selectedTestModel}
              onChange={(e) => setSelectedTestModel(e.target.value)}
              disabled={isChatting}
            >
              {availableModels.length === 0 ? (
                <option value="">{t('playground.noModels')}</option>
              ) : (
                (() => {
                  const grouped = availableModels.reduce((acc, m) => {
                    const cat = getModelCategory(m.id);
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(m);
                    return acc;
                  }, {});
                  return Object.entries(grouped).sort(([a], [b]) => {
                    if (a === 'Other') return 1;
                    if (b === 'Other') return -1;
                    return a.localeCompare(b);
                  }).map(([cat, items]) => (
                    <optgroup key={cat} label={cat}>
                      {items
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.id.split('/').shift()})
                          </option>
                        ))}
                    </optgroup>
                  ));
                })()
              )}
            </select>
            {isChatting && (
              <span style={{ fontSize: '13px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={14} className="animate-spin" />
                {t('playground.streaming')}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-secondary)', flexShrink: 0 }}>
              {t('playground.skillSelectorTitle')}
            </span>
            {DIVINATION_SKILLS.map((skill) => {
              const isSelected = selectedSkillIds.includes(skill.id);
              const toggleSkill = () => {
                if (isChatting) return;
                setSelectedSkillIds((prev) =>
                  isSelected ? prev.filter((id) => id !== skill.id) : [...prev, skill.id]
                );
              };
              return (
                <button
                  key={skill.id}
                  className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                  style={{
                    padding: '6px 14px',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderWidth: '2px',
                    borderStyle: 'solid',
                    borderColor: isSelected ? 'var(--accent-color)' : 'var(--border-color)',
                    cursor: isChatting ? 'not-allowed' : 'pointer',
                    opacity: isChatting ? 0.6 : 1,
                    transition: 'all 180ms ease',
                  }}
                  onClick={toggleSkill}
                  disabled={isChatting}
                  title={skill.shortDesc}
                >
                  <span style={{ fontSize: '16px' }}>{skill.icon}</span>
                  <span>{skill.label}</span>
                  {isSelected && (
                    <span style={{ fontSize: '11px', fontWeight: 'bold', marginLeft: '6px', opacity: 0.8 }}>✕</span>
                  )}
                </button>
              );
            })}
            {selectedSkillIds.length > 0 && (
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: '12px', opacity: 0.7 }}
                onClick={() => setSelectedSkillIds([])}
                disabled={isChatting}
                title={t('playground.clearSkills')}
              >
                ✕ {t('playground.clearSkills')}
              </button>
            )}
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            background: 'var(--terminal-bg)',
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            {chatHistory.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px' }}>
                <Cpu size={48} style={{ color: 'var(--border-color)' }} />
                <span style={{ fontSize: '15px' }}>{t('playground.enterMessage')}</span>
              </div>
            ) : (
              chatHistory.map((msg, index) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      justifyContent: isUser ? 'flex-end' : 'flex-start',
                      width: '100%'
                    }}
                  >
                    <div style={{
                      maxWidth: '75%',
                      background: isUser ? 'var(--chat-user-gradient)' : 'var(--bg-tertiary)',
                      border: isUser ? 'none' : '1px solid var(--border-color)',
                      color: isUser ? 'var(--text-on-accent)' : 'var(--text-primary)',
                      padding: '12px 16px',
                      borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      fontSize: '15px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      boxShadow: 'var(--card-shadow)',
                      userSelect: 'text'
                    }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', opacity: 0.7, display: 'block', marginBottom: '6px' }}>
                        {isUser ? `👤 ${t('playground.userLabel')}` : `🤖 ${t('playground.assistantLabel', { model: selectedTestModel.split('/').pop() })}`}
                      </span>
                      {isUser ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {msg.content}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {msg.thinkingContent ? (
                            <div style={{
                              border: '1px solid var(--border-color)',
                              borderRadius: '8px',
                              background: 'var(--bg-secondary)',
                              overflow: 'hidden'
                            }}>
                              <button
                                onClick={() => toggleThink(index)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '6px 10px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  color: 'var(--text-muted)',
                                  width: '100%',
                                  textAlign: 'left'
                                }}
                              >
                                {expandedThinkIds.has(index)
                                  ? <ChevronDown size={12} />
                                  : <ChevronRight size={12} />
                                }
                                <span>🧠 {t('playground.thinkLabel')}</span>
                                {isChatting && index === chatHistory.length - 1 && (
                                  <RefreshCw size={10} className="animate-spin" style={{ marginLeft: 'auto' }} />
                                )}
                              </button>
                              {expandedThinkIds.has(index) && (
                                <div style={{
                                  padding: '0 10px 10px 10px',
                                  fontSize: '13px',
                                  lineHeight: '1.6',
                                  color: 'var(--text-secondary)',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word'
                                }}>
                                  <MarkdownContent>{msg.thinkingContent}</MarkdownContent>
                                </div>
                              )}
                            </div>
                          ) : isChatting && !msg.content && index === chatHistory.length - 1 ? (
                            <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Thinking...
                            </div>
                          ) : null}
                          <div className="markdown-body" style={{ fontSize: '14px', lineHeight: '1.6' }}>
                            <MarkdownContent>{msg.content}</MarkdownContent>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {selectedSkillIds.includes('meihua') && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '4px 0' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>🌸 梅花起卦輔助：</span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => {
                  const num1 = Math.floor(Math.random() * 999) + 1;
                  const num2 = Math.floor(Math.random() * 999) + 1;
                  const num3 = Math.floor(Math.random() * 999) + 1;
                  const prefix = chatInput.trim() ? `${chatInput.trim()} ` : '';
                  setChatInput(`${prefix}（靈動數：${num1}, ${num2}, ${num3}）`);
                }}
                disabled={isChatting}
              >
                🎲 注入隨機靈動數
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => {
                  const now = new Date();
                  const timeStr = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
                  const prefix = chatInput.trim() ? `${chatInput.trim()} ` : '';
                  setChatInput(`${prefix}（當前時間起卦：${timeStr}）`);
                }}
                disabled={isChatting}
              >
                ⏰ 注入當前時間
              </button>
            </div>
          )}

          <form onSubmit={handleSendTestMessage} style={{ display: 'flex', gap: '10px' }}>
            <textarea
              ref={textareaRef}
              placeholder={selectedTestModel ? "Enter message..." : "Sync models first"}
              className="input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendTestMessage(e);
                }
              }}
              disabled={!selectedTestModel || isChatting}
              style={{ flex: 1, fontSize: '15px', padding: '12px 16px', resize: 'none', minHeight: '44px' }}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0 24px', fontSize: '15px' }}
              onClick={() => handleSendTestMessage({ preventDefault: () => {} })}
              disabled={!selectedTestModel || !chatInput.trim() || isChatting}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
}
