import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LocalDB } from '../core/storage/localDatabase';
import { AgentCore } from '../core/agent/agentCore';
import { createProvider } from '../core/providers';
import { ContextCompressor } from '../core/context/contextCompressor';
import { estimateFullContextTokens, normalizeApiUsage, projectNextTurnContext } from '../core/context/tokenManager';
import { getModelContextLimit, getCompressionThreshold, getModelContextInfo } from '../core/context/modelLimits';
import { generateTitleFromPrompt, cleanFallbackTitle } from '../core/agent/titleGenerator';
import { runMeihuaPipeline } from '../core/meihua';
import { NotificationService } from '../core/notifications/notificationService';
import { writeWidgetLatestTask } from '../core/schedule/scheduleEngine';
import { NativeStreamClient } from '../core/network/nativeStreamClient';

export function useMobileChat({
  currentProviderId,
  currentModelId,
  providerConfigs,
  selectedSkillIds,
  setSelectedSkillIds,
  contextSettings
}) {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [activeSummary, setActiveSummary] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReasoningActive, setIsReasoningActive] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionToast, setCompressionToast] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null); // Ephemeral progress UI state: { phase, meta }
  const [attachedImages, setAttachedImages] = useState([]);

  const addImages = useCallback((newImages) => {
    if (!newImages) return;
    const list = Array.isArray(newImages) ? newImages : [newImages];
    setAttachedImages(prev => [...prev, ...list]);
  }, []);

  const removeImage = useCallback((id) => {
    setAttachedImages(prev => prev.filter(img => img.id !== id));
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages([]);
  }, []);

  const currentConversationIdRef = useRef(null);
  currentConversationIdRef.current = currentConversationId;

  // Active runs registry: runId -> { conversationId, agentCore, startedAt, accumulatedContent, accumulatedThinking, liveToolExecutions }
  const activeRunsRef = useRef(new Map());
  const finalizedRunsRef = useRef(new Set());
  const loadMessagesGenRef = useRef(0); // Anti-race condition generation counter
  const queuedFollowUpRef = useRef(null); // Follow-up messages queued while streaming

  // Load conversations on mount
  useEffect(() => {
    async function loadConversations() {
      const rawList = await LocalDB.getConversations();
      const validList = [];
      for (const conv of rawList) {
        const msgs = await LocalDB.getMessages(conv.id);
        if (msgs && msgs.length > 0) {
          const hasMeihuaFeature = conv.type === 'meihua' ||
            (Array.isArray(conv.skillIds) && conv.skillIds.includes('meihua'));

          let cleanTitle = conv.title || '';
          if (cleanTitle.includes('<meihua-numbers')) {
            cleanTitle = cleanTitle.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>/gi, '').replace(/<meihua-numbers[^>]*\/>/gi, '').trim();
          }

          const normalizedConv = {
            ...conv,
            ...(hasMeihuaFeature ? { type: 'meihua' } : {}),
            title: cleanTitle || conv.title || '新對話'
          };

          if (normalizedConv.type !== conv.type || normalizedConv.title !== conv.title) {
            await LocalDB.saveConversation(normalizedConv);
          }

          validList.push(normalizedConv);
        } else {
          await LocalDB.deleteConversation(conv.id);
          await LocalDB.deleteConversationSummary(conv.id);
        }
      }

      if (validList.length > 0) {
        setConversations(validList);
        let targetId = validList[0].id;
        const pendingWidgetConv = (typeof window !== 'undefined' && window.NativeStreamBridge && typeof window.NativeStreamBridge.getPendingConversationId === 'function')
          ? window.NativeStreamBridge.getPendingConversationId()
          : null;
        if (pendingWidgetConv && validList.some(c => c.id === pendingWidgetConv)) {
          targetId = pendingWidgetConv;
        } else if (currentConversationIdRef.current && validList.some(c => c.id === currentConversationIdRef.current)) {
          targetId = currentConversationIdRef.current;
        }
        currentConversationIdRef.current = targetId;
        setCurrentConversationId(targetId);
      } else {
        const draftConv = {
          id: `conv_${Date.now()}`,
          title: '新對話',
          providerId: currentProviderId,
          modelId: currentModelId,
          skillIds: (selectedSkillIds || []).filter(id => id !== 'meihua')
        };
        setConversations([draftConv]);
        currentConversationIdRef.current = draftConv.id;
        setCurrentConversationId(draftConv.id);
      }
    }
    loadConversations();
  }, []);

  // Load messages, summary, and skill settings with Anti-Race Condition Generation Protection
  const cleanedConvsRef = useRef(new Set());

  useEffect(() => {
    if (!currentConversationId) return;

    const currentGen = ++loadMessagesGenRef.current;

    async function loadMessagesAndSummary() {
      const msgs = await LocalDB.getMessages(currentConversationId);
      const summary = await LocalDB.getConversationSummary(currentConversationId);
      if (loadMessagesGenRef.current !== currentGen) return; // Stale query discarded

      // Check if current conversation has an active background stream running
      let activeRunForConv = null;
      for (const run of activeRunsRef.current.values()) {
        if (run.conversationId === currentConversationId) {
          activeRunForConv = run;
          break;
        }
      }
      setIsStreaming(Boolean(activeRunForConv));

      // CRITICAL: If an active stream exists with a live in-flight assistant message not yet in DB, keep it in view!
      if (activeRunForConv?.liveAssistantMsg) {
        if (!msgs.some(m => m.id === activeRunForConv.liveAssistantMsg.id)) {
          setMessages([...msgs, activeRunForConv.liveAssistantMsg]);
        } else {
          setMessages(msgs);
        }
      } else {
        setMessages(msgs);
      }
      setActiveSummary(summary || null);

      const conv = await LocalDB.getConversation(currentConversationId);
      if (loadMessagesGenRef.current !== currentGen) return;

      const convSkills = Array.isArray(conv?.skillIds)
        ? conv.skillIds
        : (conv?.type === 'meihua' ? ['meihua'] : []);
      setSelectedSkillIds(convSkills);

      // Lazy one-time cleanup: only scan for orphaned protocol rows once per conversation per session
      if (!cleanedConvsRef.current.has(currentConversationId)) {
        cleanedConvsRef.current.add(currentConversationId);
        // Bound cleanup tracker to prevent unbounded memory growth
        if (cleanedConvsRef.current.size > 30) {
          const oldest = [...cleanedConvsRef.current].slice(0, cleanedConvsRef.current.size - 15);
          oldest.forEach(id => cleanedConvsRef.current.delete(id));
        }
        // Only scan DB if loaded messages actually contain orphans (fast in-memory check first)
        const hasOrphans = msgs.some(m => m.role === 'tool' || (m.role === 'assistant' && !m.content?.trim() && !m.thinkingContent?.trim() && (!m.toolExecutions || m.toolExecutions.length === 0)));
        if (hasOrphans) {
          await LocalDB.cleanupOrphanedToolMessages(currentConversationId);
          // Re-read after cleanup
          if (loadMessagesGenRef.current === currentGen) {
            const cleaned = await LocalDB.getMessages(currentConversationId);
            setMessages(cleaned);
          }
        }
      }
    }
    loadMessagesAndSummary();
  }, [currentConversationId]);

  // Calculate live Context Token usage & Model limit (accounting for active compressed summary)
  const contextStats = useMemo(() => {
    const contextInfo = getModelContextInfo(currentModelId);
    const maxTokens = contextInfo.limit;
    const threshold = getCompressionThreshold(currentModelId);

    // Empty conversation has strictly 0 tokens
    if (messages.length === 0 && !input.trim()) {
      return {
        usedTokens: 0,
        maxTokens,
        threshold,
        isNearLimit: false,
        isOverThreshold: false,
        provenance: contextInfo.provenance,
        isAuthoritative: false
      };
    }

    // If an active summary exists, compute tokens based on the summary + remaining unsummarized messages
    if (activeSummary && activeSummary.summarizedUntilMessageId) {
      const lastIdx = messages.findIndex(m => m.id === activeSummary.summarizedUntilMessageId);
      const unsummarized = lastIdx !== -1 ? messages.slice(lastIdx + 1) : messages;

      const projectedTokens = estimateFullContextTokens({
        systemPrompt: 'System Prompt + Context',
        summary: activeSummary.summary || '',
        messages: unsummarized,
        currentInput: input
      }).totalTokens;

      const isNearLimit = projectedTokens >= Math.floor(threshold * 0.9);
      const isOverThreshold = projectedTokens >= threshold;

      return {
        usedTokens: projectedTokens,
        maxTokens,
        threshold,
        isNearLimit,
        isOverThreshold,
        provenance: 'compressed_summary',
        isAuthoritative: false
      };
    }

    // Find latest message with authoritative API usage
    let latestApiUsage = null;
    let messagesSinceLastUsage = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.usage && m.usage.totalTokens > 0) {
        latestApiUsage = m.usage;
        messagesSinceLastUsage = messages.slice(i + 1);
        break;
      }
    }

    if (!latestApiUsage) {
      messagesSinceLastUsage = messages;
    }

    const projectedTokens = projectNextTurnContext({
      lastAuthoritativeUsage: latestApiUsage,
      newMessagesSinceLastTurn: messagesSinceLastUsage,
      currentInput: input,
      systemPrompt: 'System Prompt + Context'
    });

    const isNearLimit = projectedTokens >= Math.floor(threshold * 0.9);
    const isOverThreshold = projectedTokens >= threshold;

    return {
      usedTokens: projectedTokens,
      maxTokens,
      threshold,
      isNearLimit,
      isOverThreshold,
      provenance: contextInfo.provenance,
      isAuthoritative: Boolean(latestApiUsage)
    };
  }, [currentModelId, messages, input, activeSummary]);

  // Create new conversation (In-memory draft until first message is sent)
  const newChat = useCallback(async () => {
    setIsStreaming(false);
    setIsReasoningActive(false);
    setLiveStatus(null);
    setActiveSummary(null);

    const currId = currentConversationIdRef.current;
    if (currId) {
      const currMsgs = await LocalDB.getMessages(currId);
      if (currMsgs.length === 0) {
        await LocalDB.deleteConversation(currId);
        await LocalDB.deleteConversationSummary(currId);
      }
    }

    const newConv = {
      id: `conv_${Date.now()}`,
      title: '新對話',
      providerId: currentProviderId,
      modelId: currentModelId,
      skillIds: (selectedSkillIds || []).filter(id => id !== 'meihua')
    };

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== currId || messages.length > 0);
      return [newConv, ...filtered];
    });
    setCurrentConversationId(newConv.id);
    setSelectedSkillIds(prev => (Array.isArray(prev) ? prev.filter(id => id !== 'meihua') : []));
    setMessages([]);
    setInput('');
  }, [currentProviderId, currentModelId, selectedSkillIds, messages.length, setSelectedSkillIds]);

  const newMeihuaChat = useCallback(async () => {
    setIsStreaming(false);
    setIsReasoningActive(false);
    setLiveStatus(null);
    setActiveSummary(null);

    const currId = currentConversationIdRef.current;
    if (currId) {
      const currMsgs = await LocalDB.getMessages(currId);
      if (currMsgs.length === 0) {
        await LocalDB.deleteConversation(currId);
        await LocalDB.deleteConversationSummary(currId);
      }
    }

    const newConv = {
      id: `conv_${Date.now()}`,
      title: '梅花易數占卜',
      providerId: currentProviderId,
      modelId: currentModelId,
      skillIds: ['meihua'],
      type: 'meihua'
    };

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== currId || messages.length > 0);
      return [newConv, ...filtered];
    });
    setCurrentConversationId(newConv.id);
    setSelectedSkillIds(['meihua']);
    setMessages([]);
    setInput('');
  }, [currentProviderId, currentModelId, messages.length, setSelectedSkillIds]);

  // Select conversation WITHOUT aborting ongoing background streams
  const selectConversation = useCallback(async (convId) => {
    if (convId === currentConversationId) return;

    const currId = currentConversationIdRef.current;
    // Clean up current conversation if it is completely empty and not streaming
    if (currId && messages.length === 0 && !isStreaming) {
      const currMsgs = await LocalDB.getMessages(currId);
      if (currMsgs.length === 0) {
        await LocalDB.deleteConversation(currId);
        await LocalDB.deleteConversationSummary(currId);
        setConversations(prev => prev.filter(c => c.id !== currId));
      }
    }

    // Reset ephemeral active UI view state
    setIsReasoningActive(false);
    setLiveStatus(null);
    setActiveSummary(null);

    // If input contains leftover meihua numbers, clean it up when switching conversations
    setInput(prev => prev.replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '').trimStart());

    // Ensure conversation exists in local conversations state if generated in background
    setConversations(prev => {
      if (!prev.some(c => c.id === convId)) {
        LocalDB.getConversation(convId).then(dbConv => {
          if (dbConv) {
            setConversations(current => current.some(c => c.id === convId) ? current : [dbConv, ...current]);
          }
        });
      }
      return prev;
    });

    // Switch active conversation ID (background generation continues untouched)
    currentConversationIdRef.current = convId;
    setCurrentConversationId(convId);
  }, [currentConversationId, messages.length, isStreaming]);

  // Rename conversation
  const renameConversation = useCallback(async (convId, newTitle) => {
    const trimmed = newTitle?.trim();
    if (!trimmed) return;
    await LocalDB.saveConversation({
      id: convId,
      title: trimmed,
      updatedAt: Date.now()
    });
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: trimmed } : c));
  }, []);

  // Delete conversation
  const deleteConversation = useCallback(async (convId) => {
    // Abort any active run for this conversation
    for (const [rId, run] of activeRunsRef.current.entries()) {
      if (run.conversationId === convId) {
        run.agentCore?.abort();
        activeRunsRef.current.delete(rId);
      }
    }

    await LocalDB.deleteConversation(convId);
    await LocalDB.deleteConversationSummary(convId);

    setConversations(prev => {
      const updated = prev.filter(c => c.id !== convId);
      if (currentConversationId === convId) {
        if (updated.length > 0) {
          setCurrentConversationId(updated[0].id);
        } else {
          const draftConv = {
            id: `conv_${Date.now()}`,
            title: '新對話',
            providerId: currentProviderId,
            modelId: currentModelId,
            skillIds: selectedSkillIds || []
          };
          setCurrentConversationId(draftConv.id);
          return [draftConv];
        }
      }
      return updated;
    });
  }, [currentConversationId, currentProviderId, currentModelId, selectedSkillIds]);

  // Manual Context Compression action
  const compressContext = useCallback(async () => {
    if (messages.length < 2 || isCompressing || isStreaming) return;
    setIsCompressing(true);

    const activeConfig = providerConfigs[currentProviderId] || {};
    const provider = createProvider(currentProviderId, activeConfig);
    const tokensBefore = contextStats.usedTokens;

    try {
      const result = await ContextCompressor.compressIfNeeded({
        conversationId: currentConversationId,
        messages,
        provider,
        model: currentModelId,
        force: true
      });

      if (result.compressed) {
        setActiveSummary(result.summary);
        const afterEstimate = estimateFullContextTokens({
          systemPrompt: 'System',
          summary: result.summary?.summary || '',
          messages: messages.slice(-result.recentCount),
          currentInput: input
        });
        const tokensAfter = afterEstimate.totalTokens;
        setCompressionToast(`上下文已壓縮 (${tokensBefore.toLocaleString()} → ${tokensAfter.toLocaleString()} tokens)`);
        setTimeout(() => setCompressionToast(null), 4000);
      } else {
        setCompressionToast('目前歷史訊息量適中，無需重複壓縮');
        setTimeout(() => setCompressionToast(null), 3000);
      }
    } catch (err) {
      console.error('[Manual compression error]:', err);
      setCompressionToast('壓縮暫時無法完成，保留原有完整歷史');
      setTimeout(() => setCompressionToast(null), 3000);
    } finally {
      setIsCompressing(false);
    }
  }, [messages, isCompressing, isStreaming, providerConfigs, currentProviderId, currentConversationId, currentModelId, contextStats.usedTokens, input]);

  // Shared execution engine for streaming chat response
  const executeChatStream = useCallback(async (historyMessages, options = {}) => {
    const streamConvId = options.targetConvId || currentConversationIdRef.current;
    const targetModelId = options.modelId || currentModelId;
    const targetProviderId = options.providerId || currentProviderId;
    const targetSkillIds = options.skillIds !== undefined ? options.skillIds : (selectedSkillIds || []);

    if (!targetModelId || historyMessages.length === 0 || !streamConvId) return;

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now();

    const activeConfig = providerConfigs[targetProviderId] || {};
    const provider = createProvider(targetProviderId, activeConfig);

    // 1. Dynamic 80% Context Compression check
    const compressionThreshold = getCompressionThreshold(targetModelId);
    const currentTokens = estimateFullContextTokens({
      systemPrompt: 'System',
      messages: historyMessages
    }).totalTokens;

    if (currentTokens >= compressionThreshold && historyMessages.length >= 3) {
      setIsCompressing(true);
      try {
        const autoCompResult = await ContextCompressor.compressIfNeeded({
          conversationId: streamConvId,
          messages: historyMessages,
          provider,
          model: targetModelId,
          force: false
        });
        if (autoCompResult?.compressed) {
          if (currentConversationIdRef.current === streamConvId) {
            setActiveSummary(autoCompResult.summary);
          }
        }
      } catch (compErr) {
        console.warn('[Auto compression failed, proceeding with standard request]:', compErr);
      } finally {
        setIsCompressing(false);
      }
    }

    // 2. Build model request messages (uses compressed summary if available)
    const modelRequestMessages = await ContextCompressor.buildRequestContextMessages({
      conversationId: streamConvId,
      messages: historyMessages
    });

    // 2.5 Pre-calculate deterministic skill calculations (e.g. Meihua Divination Engine)
    const initialToolExecutions = [];
    if (targetSkillIds && targetSkillIds.includes('meihua')) {
      const lastUserMsg = [...historyMessages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && lastUserMsg.content) {
        try {
          const meihuaPipeline = runMeihuaPipeline(lastUserMsg.content);
          initialToolExecutions.push({
            toolCallId: `meihua_calc_${startedAt}`,
            toolName: 'meihua_calculation',
            status: 'completed',
            args: {
              method: meihuaPipeline.calculation.method,
              question: meihuaPipeline.parsedQuestion,
              randomNumbers: meihuaPipeline.calculation.randomNumbers,
              date: meihuaPipeline.calculation.date
            },
            result: {
              calculation: meihuaPipeline.calculation,
              knowledge: meihuaPipeline.knowledge
            }
          });
        } catch (err) {
          console.warn('[Meihua Calculation Hook Error]:', err);
        }
      }
    }

    const assistantMsgId = `msg_${Date.now()}_a`;
    const assistantMsg = {
      id: assistantMsgId,
      conversationId: streamConvId,
      role: 'assistant',
      modelName: targetModelId.split('/').pop(),
      content: '',
      thinkingContent: '',
      tool_calls: null,
      toolExecutions: [...initialToolExecutions], // Live UI state: [{ toolCallId, toolName, status, args, result }]
      startedAt,
      createdAt: startedAt,
      ordinal: historyMessages.length
    };

    NativeStreamClient.startBackgroundExecution('stream_' + streamConvId);
    let stoppedBackgroundExecution = false;
    const safeStopBackgroundExecution = () => {
      if (!stoppedBackgroundExecution) {
        stoppedBackgroundExecution = true;
        NativeStreamClient.stopBackgroundExecution();
      }
    };

    if (currentConversationIdRef.current === streamConvId) {
      setMessages([...historyMessages, assistantMsg]);
      setIsStreaming(true);
      setIsReasoningActive(true);
      setLiveStatus({ phase: 'thinking', meta: {} });
    }

    const agent = new AgentCore(provider);
    activeRunsRef.current.set(runId, {
      conversationId: streamConvId,
      agentCore: agent,
      liveAssistantMsg: assistantMsg
    });

    const payloadForAgent = modelRequestMessages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.images ? { images: m.images } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, name: m.name } : {})
    }));

    let accumulatedContent = '';
    let accumulatedThinking = '';
    let liveToolExecutions = [...initialToolExecutions];
    let latestReportedUsage = null;

    const updateLiveRunState = () => {
      const runRecord = activeRunsRef.current.get(runId);
      if (runRecord) {
        runRecord.liveAssistantMsg = {
          ...assistantMsg,
          content: accumulatedContent,
          thinkingContent: accumulatedThinking,
          tool_calls: assistantMsg.tool_calls || null,
          toolExecutions: [...liveToolExecutions]
        };
      }
    };

    let renderTimer = null;
    let lastRenderTime = 0;
    const RENDER_INTERVAL_MS = 40; // ~25 FPS throttling

    const commitUIRender = () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      if (currentConversationIdRef.current !== streamConvId) return;
      const currentMsgState = {
        ...assistantMsg,
        content: accumulatedContent,
        thinkingContent: accumulatedThinking,
        toolExecutions: [...liveToolExecutions]
      };
      setMessages(prev => {
        if (prev.length === 0) return [currentMsgState];
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (!last || last.id !== assistantMsgId) {
          return [...prev, currentMsgState];
        }
        return [
          ...prev.slice(0, lastIdx),
          currentMsgState
        ];
      });
    };

    const scheduleUIRender = () => {
      if (currentConversationIdRef.current !== streamConvId) return;
      const now = Date.now();
      if (now - lastRenderTime >= RENDER_INTERVAL_MS) {
        lastRenderTime = now;
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        commitUIRender();
      } else if (!renderTimer) {
        renderTimer = setTimeout(() => {
          renderTimer = null;
          lastRenderTime = Date.now();
          commitUIRender();
        }, RENDER_INTERVAL_MS - (now - lastRenderTime));
      }
    };

    await agent.runChat({
      runId,
      messages: payloadForAgent,
      model: targetModelId,
      selectedSkillIds: targetSkillIds,
      onThinking: (delta) => {
        accumulatedThinking += delta;
        updateLiveRunState();
        if (currentConversationIdRef.current === streamConvId) {
          setIsReasoningActive(true);
          scheduleUIRender();
        }
      },
      onContent: (delta) => {
        accumulatedContent += delta;
        updateLiveRunState();
        if (currentConversationIdRef.current === streamConvId) {
          setIsReasoningActive(false);
          scheduleUIRender();
        }
      },
      onStatusChange: (status) => {
        if (currentConversationIdRef.current === streamConvId) {
          setLiveStatus(status);
        }
      },
      onToolStart: (toolCalls) => {
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        accumulatedContent = ''; // Clear draft tool JSON arguments
        const newToolCalls = toolCalls.map(tc => ({
          toolCallId: tc.id,
          toolName: tc.function.name,
          status: 'calling',
          args: tc.function.arguments
        }));
        liveToolExecutions = [...initialToolExecutions, ...newToolCalls];
        updateLiveRunState();
        if (currentConversationIdRef.current === streamConvId) {
          setIsReasoningActive(false);
          const currentMsgState = {
            ...assistantMsg,
            content: '',
            tool_calls: toolCalls,
            toolExecutions: [...liveToolExecutions]
          };
          setMessages(prev => {
            if (prev.length === 0) return [currentMsgState];
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (!last || last.id !== assistantMsgId) {
              return [...prev, currentMsgState];
            }
            return [
              ...prev.slice(0, lastIdx),
              currentMsgState
            ];
          });
        }
      },
      onToolStatus: ({ toolCallId, toolName, status, args }) => {
        liveToolExecutions = liveToolExecutions.map(te =>
          te.toolCallId === toolCallId ? { ...te, status, args } : te
        );
        updateLiveRunState();
        if (currentConversationIdRef.current === streamConvId) {
          const currentMsgState = {
            ...assistantMsg,
            content: accumulatedContent,
            thinkingContent: accumulatedThinking,
            toolExecutions: [...liveToolExecutions]
          };
          setMessages(prev => {
            if (prev.length === 0) return [currentMsgState];
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (!last || last.id !== assistantMsgId) {
              return [...prev, currentMsgState];
            }
            return [
              ...prev.slice(0, lastIdx),
              currentMsgState
            ];
          });
        }
      },
      onToolResult: ({ toolCallId, toolName, args, result }) => {
        liveToolExecutions = liveToolExecutions.map(te =>
          te.toolCallId === toolCallId ? { ...te, status: 'completed', args, result } : te
        );
        updateLiveRunState();
        if (currentConversationIdRef.current === streamConvId) {
          const currentMsgState = {
            ...assistantMsg,
            content: accumulatedContent,
            thinkingContent: accumulatedThinking,
            toolExecutions: [...liveToolExecutions]
          };
          setMessages(prev => {
            if (prev.length === 0) return [currentMsgState];
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (!last || last.id !== assistantMsgId) {
              return [...prev, currentMsgState];
            }
            return [
              ...prev.slice(0, lastIdx),
              currentMsgState
            ];
          });
        }
      },
      onUsage: (rawUsage) => {
        latestReportedUsage = normalizeApiUsage(rawUsage);
      },
      onDone: async (doneData) => {
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        if (finalizedRunsRef.current.has(runId)) return;
        finalizedRunsRef.current.add(runId);
        activeRunsRef.current.delete(runId);

        // Bound the finalized runs Set to prevent unbounded memory growth in long sessions
        if (finalizedRunsRef.current.size > 50) {
          const toRemove = [...finalizedRunsRef.current].slice(0, finalizedRunsRef.current.size - 20);
          toRemove.forEach(id => finalizedRunsRef.current.delete(id));
        }

        const completedAt = Date.now();
        const durationMs = completedAt - startedAt;

        const finalNormalizedUsage = doneData?.usage ? normalizeApiUsage(doneData.usage) : latestReportedUsage;
        let finalContentToDisplay = (doneData?.content || accumulatedContent || '').trim();

        // If content is merely raw JSON tool arguments, fallback to empty
        if (
          (finalContentToDisplay.startsWith('{') && finalContentToDisplay.endsWith('}') && finalContentToDisplay.includes('"query"')) ||
          (finalContentToDisplay.startsWith('```json') && finalContentToDisplay.includes('"query"'))
        ) {
          finalContentToDisplay = '';
        }

        const finalAssistantMsg = {
          ...assistantMsg,
          content: finalContentToDisplay,
          thinkingContent: accumulatedThinking,
          tool_calls: assistantMsg.tool_calls || null,
          toolExecutions: liveToolExecutions,
          usage: finalNormalizedUsage,
          startedAt,
          completedAt,
          durationMs
        };

        // Persist single consolidated assistant message (avoids orphaned rows in DB)
        await LocalDB.saveMessage(finalAssistantMsg);

        if (currentConversationIdRef.current === streamConvId) {
          setIsStreaming(false);
          setIsReasoningActive(false);
          setLiveStatus(null);
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            return [
              ...prev.slice(0, lastIdx),
              finalAssistantMsg
            ];
          });
        }

        // Stop background execution lock held for this stream
        safeStopBackgroundExecution();

        // Smart Title generation for first turn via LLM
        let resolvedTitle = null;
        if (historyMessages.length === 1 && historyMessages[0].role === 'user') {
          try {
            const titleProvider = createProvider(currentProviderId, activeConfig);
            const generatedTitle = await generateTitleFromPrompt({
              prompt: historyMessages[0].content,
              provider: titleProvider,
              model: currentModelId
            });
            const existingConv = conversations.find(c => c.id === streamConvId);
            const isMeihuaConv = existingConv?.type === 'meihua' || existingConv?.skillIds?.includes('meihua');
            const cleanTitle = isMeihuaConv && (!generatedTitle || generatedTitle === '新對話')
              ? '梅花易數占卜'
              : generatedTitle;

            if (cleanTitle && cleanTitle.length >= 2) {
              resolvedTitle = cleanTitle;
              await LocalDB.saveConversation({
                id: streamConvId,
                title: cleanTitle,
                ...(isMeihuaConv ? { type: 'meihua' } : {}),
                updatedAt: Date.now()
              });
              setConversations(prev => prev.map(c => c.id === streamConvId ? { ...c, title: cleanTitle, ...(isMeihuaConv ? { type: 'meihua' } : {}) } : c));
            }
          } catch (_) {}
        }

        // Sync latest conversation result to Android widget ONLY for scheduled tasks
        if (options.isScheduledTask || options.taskId) {
          let convTitle = resolvedTitle;
          if (!convTitle) {
            const currentConv = conversations.find(c => c.id === streamConvId);
            convTitle = currentConv?.title;
          }
          if (!convTitle) {
            try {
              const dbConv = await LocalDB.getConversation(streamConvId);
              convTitle = dbConv?.title;
            } catch (_) {}
          }

          await writeWidgetLatestTask({
            title: convTitle || '排程任務',
            summary: finalContentToDisplay,
            conversationId: streamConvId,
            taskId: options.taskId || null
          });
        }

        // Background stream completion notification (Plan §2.2)
        const isBackground = typeof document !== 'undefined' && (document.hidden || currentConversationIdRef.current !== streamConvId);
        if (isBackground) {
          NotificationService.sendCompletionNotification({
            conversationId: streamConvId,
            title: convTitle || 'AI 解卦/對話已完成',
            body: finalContentToDisplay,
            isError: false
          });
        }

        // Process follow-up message queued while streaming
        if (queuedFollowUpRef.current && queuedFollowUpRef.current.conversationId === streamConvId) {
          queuedFollowUpRef.current = null;
          setTimeout(async () => {
            const allMsgs = await LocalDB.getMessages(streamConvId);
            executeChatStream(allMsgs, {
              targetConvId: streamConvId,
              modelId: targetModelId,
              providerId: targetProviderId,
              skillIds: targetSkillIds
            });
          }, 300);
        }
      },
      onError: async (err) => {
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        safeStopBackgroundExecution();
        if (finalizedRunsRef.current.has(runId)) return;
        finalizedRunsRef.current.add(runId);
        activeRunsRef.current.delete(runId);

        // Bound the finalized runs Set to prevent unbounded memory growth
        if (finalizedRunsRef.current.size > 50) {
          const toRemove = [...finalizedRunsRef.current].slice(0, finalizedRunsRef.current.size - 20);
          toRemove.forEach(id => finalizedRunsRef.current.delete(id));
        }

        const completedAt = Date.now();
        const durationMs = completedAt - startedAt;
        const errMsg = `\n[錯誤]: ${err.message}`;

        const finalAssistantMsg = {
          ...assistantMsg,
          content: (accumulatedContent || '') + errMsg,
          thinkingContent: accumulatedThinking,
          toolExecutions: liveToolExecutions,
          startedAt,
          completedAt,
          durationMs
        };

        await LocalDB.saveMessage(finalAssistantMsg);

        if (currentConversationIdRef.current === streamConvId) {
          setIsStreaming(false);
          setIsReasoningActive(false);
          setLiveStatus(null);
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            return [
              ...prev.slice(0, lastIdx),
              finalAssistantMsg
            ];
          });
        }

        // Background error notification (Plan §2.2)
        const isBackground = typeof document !== 'undefined' && (document.hidden || currentConversationIdRef.current !== streamConvId);
        if (isBackground) {
          const currentConv = conversations.find(c => c.id === streamConvId);
          const convTitle = currentConv?.title || 'AI 回答失敗';
          NotificationService.sendCompletionNotification({
            conversationId: streamConvId,
            title: convTitle,
            body: `錯誤: ${err.message}`,
            isError: true
          });
        }
      }
    });
  }, [currentModelId, currentProviderId, providerConfigs, selectedSkillIds]);

  // Send new user message (supports queuing/sending while streaming)
  const sendMessage = useCallback(async (customText = null) => {
    const textToSend = (customText !== null ? customText : input).trim();
    const hasImages = attachedImages.length > 0;
    if ((!textToSend && !hasImages) || !currentModelId) return;

    const currId = currentConversationId;
    const currConv = conversations.find(c => c.id === currId);

    // If stream is currently active, queue message with auxiliary prompt: [使用者又說: ...]
    if (isStreaming) {
      const followUpText = `使用者又說: ${textToSend}`;
      const followUpMsg = {
        id: `msg_${Date.now()}_u`,
        conversationId: currId,
        role: 'user',
        content: followUpText,
        ...(hasImages ? { images: attachedImages.map(img => img.url) } : {}),
        createdAt: Date.now(),
        ordinal: messages.length + 1
      };

      await LocalDB.saveMessage(followUpMsg);
      setMessages(prev => [...prev, followUpMsg]);
      setInput('');
      setAttachedImages([]);
      queuedFollowUpRef.current = followUpMsg;
      return;
    }

    const userMsg = {
      id: `msg_${Date.now()}_u`,
      conversationId: currId,
      role: 'user',
      content: textToSend,
      ...(hasImages ? { images: attachedImages.map(img => img.url) } : {}),
      createdAt: Date.now(),
      ordinal: messages.length
    };

    // If this is the first message in this conversation, persist conversation record to LocalDB
    if (messages.length === 0) {
      const isMeihuaConv = currConv?.type === 'meihua' || /<meihua-numbers/i.test(textToSend);

      const initialTitle = isMeihuaConv
        ? (textToSend ? cleanFallbackTitle(textToSend) : '梅花易數占卜')
        : (textToSend ? cleanFallbackTitle(textToSend) : '圖片分析');
      const finalTitle = (initialTitle && initialTitle !== '新對話') ? initialTitle : (isMeihuaConv ? '梅花易數占卜' : '新對話');

      const convToSave = {
        id: currId,
        title: currConv?.title && currConv.title !== '新對話' && !currConv.title.includes('<meihua-numbers') ? currConv.title : finalTitle,
        providerId: currentProviderId,
        modelId: currentModelId,
        skillIds: isMeihuaConv && !selectedSkillIds?.includes('meihua') ? [...(selectedSkillIds || []), 'meihua'] : (selectedSkillIds || []),
        ...(isMeihuaConv ? { type: 'meihua' } : (currConv?.type ? { type: currConv.type } : {})),
        updatedAt: Date.now()
      };
      await LocalDB.saveConversation(convToSave);
      setConversations(prev => prev.map(c => c.id === currId ? { ...c, ...convToSave, title: convToSave.title } : c));
    }

    await LocalDB.saveMessage(userMsg);
    setInput('');
    setAttachedImages([]);

    await executeChatStream([...messages, userMsg]);
  }, [input, attachedImages, currentModelId, isStreaming, currentConversationId, messages, conversations, currentProviderId, selectedSkillIds, executeChatStream]);

  // Simulate user creating a new chat and streaming a prompt (e.g. for Scheduled Tasks)
  const simulateUserChat = useCallback(async ({
    title,
    prompt,
    skillIds,
    providerId,
    modelId,
    shouldSwitchView = true
  }) => {
    const startedAt = Date.now();
    const convId = `conv_task_${startedAt}`;
    const pId = providerId || currentProviderId;
    const mId = modelId || currentModelId;
    const skills = skillIds || ['daily-fortune'];

    const newConv = {
      id: convId,
      title: title || '排程任務',
      providerId: pId,
      modelId: mId,
      skillIds: skills,
      type: 'chat',
      createdAt: startedAt,
      updatedAt: startedAt
    };

    await LocalDB.saveConversation(newConv);
    setConversations(prev => [newConv, ...prev]);

    const userMsg = {
      id: `msg_${startedAt}_u`,
      conversationId: convId,
      role: 'user',
      content: prompt,
      createdAt: startedAt,
      ordinal: 0
    };

    await LocalDB.saveMessage(userMsg);

    if (shouldSwitchView) {
      currentConversationIdRef.current = convId;
      setCurrentConversationId(convId);
      setSelectedSkillIds(skills);
      setMessages([userMsg]);
    }

    // Launch real-time streaming generation
    await executeChatStream([userMsg], {
      targetConvId: convId,
      modelId: mId,
      providerId: pId,
      skillIds: skills,
      isScheduledTask: true
    });

    return { conversationId: convId };
  }, [currentProviderId, currentModelId, executeChatStream, setSelectedSkillIds]);

  // Stop Generation for current active conversation
  const stopGeneration = useCallback(() => {
    for (const [rId, run] of activeRunsRef.current.entries()) {
      if (run.conversationId === currentConversationId) {
        run.agentCore?.abort();
        activeRunsRef.current.delete(rId);
      }
    }
    setIsStreaming(false);
    setIsReasoningActive(false);
    setLiveStatus(null);
  }, [currentConversationId]);

  // Regenerate / Retry response
  const regenerate = useCallback(async () => {
    if (messages.length === 0 || isStreaming) return;

    for (const [rId, run] of activeRunsRef.current.entries()) {
      if (run.conversationId === currentConversationId) {
        run.agentCore?.abort();
        activeRunsRef.current.delete(rId);
      }
    }

    let baseHistory = [...messages];
    const lastMsg = baseHistory[baseHistory.length - 1];

    if (lastMsg.role === 'assistant') {
      await LocalDB.deleteMessage(lastMsg.id);
      baseHistory = baseHistory.slice(0, -1);
    }

    if (baseHistory.length === 0) return;

    await executeChatStream(baseHistory);
  }, [messages, isStreaming, currentConversationId, executeChatStream]);

  // Delete message
  const deleteMessage = useCallback(async (msgId) => {
    await LocalDB.deleteMessage(msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    await ContextCompressor.invalidateSummaryIfNeeded(currentConversationId, msgId, messages);
    const updatedSummary = await LocalDB.getConversationSummary(currentConversationId);
    setActiveSummary(updatedSummary || null);
  }, [currentConversationId, messages]);

  // Edit message
  const editMessage = useCallback(async (msgId, newContent) => {
    const targetIdx = messages.findIndex(m => m.id === msgId);
    if (targetIdx === -1) return;

    const targetMsg = messages[targetIdx];
    const updatedMsg = { ...targetMsg, content: newContent };

    await LocalDB.updateMessage(msgId, { content: newContent });

    if (targetMsg.role === 'user') {
      await ContextCompressor.invalidateSummaryIfNeeded(currentConversationId, msgId, messages);
      const updatedSummary = await LocalDB.getConversationSummary(currentConversationId);
      setActiveSummary(updatedSummary || null);
      await LocalDB.deleteMessagesAfter(currentConversationId, targetMsg.createdAt);
      const newHistory = [...messages.slice(0, targetIdx), updatedMsg];
      setMessages(newHistory);
      await executeChatStream(newHistory);
    } else {
      setMessages(prev => prev.map(m => m.id === msgId ? updatedMsg : m));
    }
  }, [messages, currentConversationId, executeChatStream]);

  return {
    conversations,
    currentConversationId,
    messages,
    input,
    setInput,
    activeSummary,
    isStreaming,
    isReasoningActive,
    isCompressing,
    liveStatus,
    contextStats,
    compressionToast,
    compressContext,
    newChat,
    newMeihuaChat,
    selectConversation,
    renameConversation,
    deleteConversation,
    sendMessage,
    simulateUserChat,
    stopGeneration,
    regenerate,
    deleteMessage,
    editMessage,
    attachedImages,
    setAttachedImages,
    addImages,
    removeImage,
    clearImages
  };
}
