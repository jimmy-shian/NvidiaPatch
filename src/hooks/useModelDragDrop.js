import { useState, useRef, useCallback } from 'react';

export default function useModelDragDrop({
  models,
  setModels,
  saveModelPriorities,
  buildModelsFromOrder
}) {
  const [draggedModelIndex, setDraggedModelIndex] = useState(null);
  const [draggedAvailableModelId, setDraggedAvailableModelId] = useState(null);
  const [isPriorityDropActive, setIsPriorityDropActive] = useState(false);
  const [priorityDropIndex, setPriorityDropIndex] = useState(null);
  const localModelOrderRef = useRef(null);
  const isDroppingRef = useRef(false);

  const getInsertOrder = useCallback((modelId, insertIndex, sourceOrder = models.map(m => m.model_id)) => {
    if (!modelId) return sourceOrder;

    const originalIndex = sourceOrder.indexOf(modelId);
    const withoutDragged = sourceOrder.filter(id => id !== modelId);
    let nextIndex = Math.max(0, Math.min(insertIndex, withoutDragged.length));

    if (originalIndex !== -1 && insertIndex > originalIndex) {
      nextIndex = Math.max(0, nextIndex - 1);
    }

    const updated = [...withoutDragged];
    updated.splice(nextIndex, 0, modelId);
    return updated;
  }, [models]);

  const getDropIndexFromEvent = useCallback((e) => {
    const container = e.currentTarget.classList.contains('priority-drop-zone')
      ? e.currentTarget
      : e.currentTarget.closest('.priority-drop-zone');

    if (!container) return models.length;

    const cards = Array.from(container.querySelectorAll('.priority-model-card'));
    if (cards.length === 0) return 0;

    const clientY = e.clientY;

    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const middleY = rect.top + rect.height / 2;
      if (clientY < middleY) {
        return i;
      }
    }

    return cards.length;
  }, [models.length]);

  const handleAvailableModelDragStart = (e, modelId) => {
    if (!modelId || models.some(m => m.model_id === modelId)) return;
    setDraggedAvailableModelId(modelId);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-nvidia-model-id', modelId);
    e.dataTransfer.setData('text/plain', modelId);
  };

  const handleAvailableModelDragEnd = () => {
    setDraggedAvailableModelId(null);
    setIsPriorityDropActive(false);
    setPriorityDropIndex(null);
  };

  const handlePriorityDragOver = (e) => {
    const types = Array.from(e.dataTransfer.types || []);
    const hasAvailableModel = draggedAvailableModelId || types.includes('application/x-nvidia-model-id');
    const hasPriorityModel = draggedModelIndex !== null || types.includes('application/x-nvidia-priority-index');
    if (!hasAvailableModel && !hasPriorityModel) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasPriorityModel ? 'move' : 'copy';
    setIsPriorityDropActive(true);
    setPriorityDropIndex(getDropIndexFromEvent(e));
  };

  const handlePriorityDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsPriorityDropActive(false);
    setPriorityDropIndex(null);
  };

  const handlePriorityDrop = async (e) => {
    e.preventDefault();
    if (isDroppingRef.current) return;
    isDroppingRef.current = true;

    try {
      const modelId =
        e.dataTransfer.getData('application/x-nvidia-model-id') ||
        e.dataTransfer.getData('application/x-nvidia-priority-model-id') ||
        draggedAvailableModelId;
      if (!modelId) return;

      const insertIndex = getDropIndexFromEvent(e);
      const currentOrder = localModelOrderRef.current || models.map(m => m.model_id);
      const isExistingPriorityModel = currentOrder.includes(modelId);
      if (!isExistingPriorityModel && models.some(m => m.model_id === modelId)) return;

      const previousModels = models;
      const updated = getInsertOrder(modelId, insertIndex, currentOrder);
      setIsPriorityDropActive(false);
      setPriorityDropIndex(null);
      setDraggedModelIndex(null);
      setDraggedAvailableModelId(null);

      try {
        setModels(buildModelsFromOrder(updated));
        await saveModelPriorities(updated);
      } catch (err) {
        setModels(previousModels);
      }
    } finally {
      isDroppingRef.current = false;
      localModelOrderRef.current = null;
    }
  };

  return {
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
  };
}
