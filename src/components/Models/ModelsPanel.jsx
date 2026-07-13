import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Cpu, CheckCircle, Activity, Globe, ArrowUp, ArrowDown, X } from 'lucide-react';
import ErrorBoundary from '../shared/ErrorBoundary';
import useModelDragDrop from '../../hooks/useModelDragDrop';
import { formatSyncTime } from '../../utils/formatting';
import { getModelEmoji, getModelCategory } from '../../utils/modelMeta';

const getSyncSourceLabel = (source) => {
  if (!source) return '';
  if (source.includes('build.nvidia.com')) return 'NVIDIA Build Free Endpoint';
  if (source.includes('featured-models')) return 'Featured Catalog';
  if (source.includes('/v1/models')) return '/v1/models';
  return source;
};

export default function ModelsPanel({
  models,
  setModels,
  modelGroups,
  activeModelGroup,
  availableModels,
  lastSyncTime,
  lastSyncSource,
  expectedModelCount,
  lastParsedModelCount,
  lastSavedModelCount,
  isSyncingModels,
  syncNotice,
  searchTerm,
  setSearchTerm,
  selectedCategory,
  setSelectedCategory,
  handleSyncModels,
  handleSwitchModelGroup,
  handleMovePriority,
  handleRemoveModelFromPriority,
  handleAddModelToPriority,
  saveModelPriorities,
  buildModelsFromOrder
}) {
  const { t } = useTranslation();

  const {
    draggedModelIndex,
    setDraggedModelIndex,
    draggedAvailableModelId,
    setDraggedAvailableModelId,
    isPriorityDropActive,
    setIsPriorityDropActive,
    priorityDropIndex,
    setPriorityDropIndex,
    localModelOrderRef,
    handleAvailableModelDragStart,
    handleAvailableModelDragEnd,
    handlePriorityDragOver,
    handlePriorityDragLeave,
    handlePriorityDrop
  } = useModelDragDrop({
    models,
    setModels,
    saveModelPriorities,
    buildModelsFromOrder
  });

  return (
    <ErrorBoundary name="ModelsPanel">
      <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>{t('models.title')}</h2>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {t('models.description')}
            </p>
            {lastSyncTime && (
              <div className="sync-info-container">
                <div className="sync-info-chip last-sync" title={t('models.lastSync')}>
                  <RefreshCw size={12} className={isSyncingModels ? 'animate-spin' : ''} />
                  <span>{t('models.lastSync')}: {formatSyncTime(lastSyncTime)}</span>
                </div>
                {Number.isFinite(Number(lastParsedModelCount ?? availableModels.length)) && (
                  <div className="sync-info-chip parsed">
                    <Cpu size={12} />
                    <span>{t('models.parsed')}: {lastParsedModelCount ?? availableModels.length}</span>
                  </div>
                )}
                {Number.isFinite(Number(lastSavedModelCount ?? availableModels.length)) && (
                  <div className="sync-info-chip saved">
                    <CheckCircle size={12} />
                    <span>{t('models.saved')}: {lastSavedModelCount ?? availableModels.length}</span>
                  </div>
                )}
                {Number.isFinite(Number(expectedModelCount)) && (
                  <div className="sync-info-chip expected">
                    <Activity size={12} />
                    <span>{t('models.expected')}: {expectedModelCount}</span>
                  </div>
                )}
                {lastSyncSource && (
                  <div className="sync-info-chip source">
                    <Globe size={12} />
                    <span>{t('models.source')}: {getSyncSourceLabel(lastSyncSource)}</span>
                  </div>
                )}
              </div>
            )}
            {syncNotice && (
              <div
                className={`sync-notice sync-notice-${syncNotice.type}`}
                role="status"
                aria-live="polite"
                style={{ marginTop: '8px' }}
              >
                {syncNotice.message}
              </div>
            )}
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleSyncModels}
            disabled={isSyncingModels}
          >
            <RefreshCw size={14} className={isSyncingModels ? 'animate-spin' : ''} />
            <span>{isSyncingModels ? t('models.syncing') : t('models.syncButton')}</span>
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', gap: '20px', overflow: 'hidden' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700' }}>⚙️ {t('models.currentOrder', { group: activeModelGroup })}</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', minWidth: 0 }}>
              {[1, 2, 3].map((groupId) => {
                const groupInfo = modelGroups.find(g => g.group_id === groupId) || { count: groupId === activeModelGroup ? models.length : 0, primary_model: null };
                const primaryText = groupInfo.primary_model ? groupInfo.primary_model.split('/').pop() : '--';
                return (
                  <button
                    key={groupId}
                    className={`btn ${activeModelGroup === groupId ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '8px 10px', fontSize: '13px', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', minWidth: 0, overflow: 'hidden' }}
                    onClick={() => handleSwitchModelGroup(groupId)}
                    title={t('models.groupLabel', { group: groupId })}
                  >
                    <span style={{ fontWeight: '800' }}>{t('models.groupLabel', { group: groupId })} {activeModelGroup === groupId ? t('models.activeGroup') : t('models.switchable')}</span>
                    <span className="model-group-summary-line">
                      <span className="model-group-count">{groupInfo.count || 0} | </span>
                      <span className="model-group-marquee" title={primaryText}>
                        <span className="model-group-marquee-track">
                          <span>{primaryText}</span>
                          <span className="model-group-marquee-spacer">　　</span>
                          <span aria-hidden="true">{primaryText}</span>
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              className={`priority-drop-zone ${isPriorityDropActive ? 'is-drag-over' : ''}`}
              style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}
              onDragOver={(e) => handlePriorityDragOver(e)}
              onDragLeave={handlePriorityDragLeave}
              onDrop={(e) => handlePriorityDrop(e)}
            >
              {models.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px' }}>
                  {t('models.noModels')}
                </div>
              ) : (
                <>
                  {models.map((m, index) => (
                    <React.Fragment key={m.id || m.model_id}>
                      {priorityDropIndex === index && (
                        <div className="priority-drop-indicator" aria-hidden="true" />
                      )}
                      <div
                        className={`glass-panel priority-model-card ${draggedModelIndex === index ? 'is-dragging' : ''}`}
                        style={{
                          padding: '12px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          border: '1px solid var(--border-color)',
                          borderLeft: `5px solid ${index === 0 ? 'var(--status-active)' : 'var(--status-cooldown)'}`,
                          borderRadius: '8px',
                          cursor: 'move',
                          background: 'var(--bg-secondary)',
                          marginBottom: '4px'
                        }}
                        draggable
                        onDragStart={(e) => {
                          setDraggedModelIndex(index);
                          localModelOrderRef.current = models.map(m2 => m2.model_id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('application/x-nvidia-priority-index', String(index));
                          e.dataTransfer.setData('application/x-nvidia-priority-model-id', m.model_id);
                          e.dataTransfer.setData('text/plain', m.model_id);
                        }}
                        onDragOver={(e) => {
                          e.stopPropagation();
                          handlePriorityDragOver(e);
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          handlePriorityDrop(e);
                        }}
                        onDragEnd={() => {
                          setDraggedModelIndex(null);
                          setDraggedAvailableModelId(null);
                          setIsPriorityDropActive(false);
                          setPriorityDropIndex(null);
                          localModelOrderRef.current = null;
                        }}
                        title={t('common.dragToReorder')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '75%', minWidth: 0 }}>
                          <span style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: index === 0 ? 'var(--bg-active)' : 'var(--bg-cooldown)',
                            color: index === 0 ? 'var(--text-active)' : 'var(--text-cooldown)',
                            border: `1px solid ${index === 0 ? 'var(--border-active)' : 'var(--border-cooldown)'}`,
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap'
                          }}>
                            #{m.priority} {index === 0 ? t('models.primary') : t('models.backup')}
                          </span>
                          <span style={{ fontSize: '14px', fontWeight: '600', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{m.model_id}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-secondary" style={{ padding: '6px' }} disabled={index === 0} onClick={() => handleMovePriority(index, 'up')}>
                            <ArrowUp size={12} />
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '6px' }} disabled={index === models.length - 1} onClick={() => handleMovePriority(index, 'down')}>
                            <ArrowDown size={12} />
                          </button>
                          <button className="btn btn-danger" style={{ padding: '6px' }} onClick={() => handleRemoveModelFromPriority(m.model_id)}>
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                  {priorityDropIndex === models.length && (
                    <div className="priority-drop-indicator" aria-hidden="true" />
                  )}
                </>
              )}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700' }}>🌐 {t('models.availableModels')}</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                placeholder={t('models.searchPlaceholder')}
                className="input"
                style={{ width: '100%', padding: '8px 12px', fontSize: '15px' }}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {['ALL', 'Llama', 'GPT', 'Nemotron', 'Phi', 'MiniMax', 'Step', 'Nvidia', 'Other'].map(cat => (
                  <button
                    key={cat}
                    className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '4px 10px', fontSize: '13px', borderRadius: '6px' }}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat === 'ALL' ? 'All' : cat}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {availableModels.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', padding: '20px' }}>
                  {t('models.noSyncData')}
                </div>
              ) : (
                (() => {
                  const searchTerms = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
                  const filtered = availableModels.filter(am => {
                    const matchesSearch = searchTerms.length === 0 || searchTerms.some(term =>
                      am.name.toLowerCase().includes(term) || am.id.toLowerCase().includes(term)
                    );
                    const matchesCategory = selectedCategory === 'ALL' || getModelCategory(am.id) === selectedCategory;
                    return matchesSearch && matchesCategory;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', padding: '20px' }}>
                        {t('models.noCategoryMatch')}
                      </div>
                    );
                  }

                  return filtered.map((am) => {
                    const isAdded = models.some(m => m.model_id === am.id);
                    return (
                      <div
                        key={am.id}
                        className={`available-model-card ${isAdded ? 'is-added' : ''}`}
                        draggable={!isAdded}
                        onDragStart={(e) => handleAvailableModelDragStart(e, am.id)}
                        onDragEnd={handleAvailableModelDragEnd}
                        title={isAdded ? 'Already in priority list' : 'Drag to priority list'}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 14px',
                          background: isAdded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          opacity: draggedAvailableModelId === am.id ? 0.55 : 1,
                          boxShadow: 'var(--card-shadow)',
                          marginBottom: '2px'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '80%', minWidth: 0, gap: '2px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{am.name}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{am.id}</span>
                        </div>
                        <button
                          className={isAdded ? 'btn btn-secondary' : 'btn btn-primary'}
                          style={{ padding: '6px 12px', fontSize: '13px', opacity: isAdded ? 0.7 : 1 }}
                          disabled={isAdded}
                          onClick={() => !isAdded && handleAddModelToPriority(am.id)}
                        >
                          {isAdded ? t('models.added') : t('models.add')}
                        </button>
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
