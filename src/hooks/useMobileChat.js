import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LocalDB } from '../core/storage/localDatabase';
import { AgentCore } from '../core/agent/agentCore';
import { createProvider } from '../core/providers';
import { ContextCompressor } from '../core/context/contextCompressor';
import { estimateFullContextTokens, normalizeApiUsage, projectNextTurnContext } from '../core/context/tokenManager';
import { getModelContextLimit, getCompressionThreshold, getModelContextInfo } from '../core/context/modelLimits';
import { generateTitleFromPrompt, cleanFallbackTitle } from '../core/agent/titleGenerator';

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

  const currentConversationIdRef = useRef(null);
  currentConversationIdRef.current = currentConversationId;

  // Active runs registry: runId -> { conversationId, agentCore, startedAt, accumulatedContent, accumulatedThinking, liveToolExecutions }
  const activeRunsRef = useRef(new Map());
  const finalizedRunsRef = useRef(new Set());
  const loadMessagesGenRef = useRef(0); // Anti-race condition generation counter

  // Load conversations on mount
  useEffect(() => {
    async function loadConversations() {
      const list = await LocalDB.getConversations();
      setConversations(list);
      if (list.length > 0) {
        setCurrentConversationId(list[0].id);
      } else {
        const newConv = await LocalDB.saveConversation({
          id: `conv_${Date.now()}`,
          title: '新對話',
          providerId: currentProviderId,
          modelId: currentModelId,
          skillIds: []
        });
        setConversations([newConv]);
        setCurrentConversationId(newConv.id);
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

      setMessages(msgs);
      setActiveSummary(summary || null);

      // Check if current conversation has an active background stream running
      let hasActiveStreamForConv = false;
      for (const run of activeRunsRef.current.values()) {
        if (run.conversationId === currentConversationId) {
          hasActiveStreamForConv = true;
          break;
        }
      }
      setIsStreaming(hasActiveStreamForConv);

      const conv = await LocalDB.getConversation(currentConversationId);
      if (loadMessagesGenRef.current !== currentGen) return;

      if (conv?.skillIds) {
        setSelectedSkillIds(conv.skillIds);
      }

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

  // Create new conversation
  const newChat = useCallback(async () => {
    setIsStreaming(false);
    setIsReasoningActive(false);
    setLiveStatus(null);
    setActiveSummary(null);

    const newConv = await LocalDB.saveConversation({
      id: `conv_${Date.now()}`,
      title: '新對話',
      providerId: currentProviderId,
      modelId: currentModelId,
      skillIds: selectedSkillIds || []
    });

    setConversations(prev => [newConv, ...prev]);
    setCurrentConversationId(newConv.id);
    setMessages([]);
    setInput('');
  }, [currentProviderId, currentModelId, selectedSkillIds]);

  // Select conversation WITHOUT aborting ongoing background streams
  const selectConversation = useCallback((convId) => {
    if (convId === currentConversationId) return;

    // Reset ephemeral active UI view state
    setIsReasoningActive(false);
    setLiveStatus(null);
    setActiveSummary(null);

    // Switch active conversation ID (background generation continues untouched)
    setCurrentConversationId(convId);
  }, [currentConversationId]);

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
          newChat();
        }
      }
      return updated;
    });
  }, [currentConversationId, newChat]);

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
  const executeChatStream = useCallback(async (historyMessages) => {
    const streamConvId = currentConversationIdRef.current;
    if (!currentModelId || historyMessages.length === 0 || !streamConvId) return;

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now();

    const activeConfig = providerConfigs[currentProviderId] || {};
    const provider = createProvider(currentProviderId, activeConfig);

    // 1. Dynamic 80% Context Compression check
    const compressionThreshold = getCompressionThreshold(currentModelId);
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
          model: currentModelId,
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

    const assistantMsgId = `msg_${Date.now()}_a`;
    const assistantMsg = {
      id: assistantMsgId,
      conversationId: streamConvId,
      role: 'assistant',
      modelName: currentModelId.split('/').pop(),
      content: '',
      thinkingContent: '',
      tool_calls: null,
      toolExecutions: [], // Live UI state: [{ toolCallId, toolName, status, args, result }]
      startedAt,
      createdAt: startedAt,
      ordinal: historyMessages.length
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
      agentCore: agent
    });

    const payloadForAgent = modelRequestMessages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, name: m.name } : {})
    }));

    let accumulatedContent = '';
    let accumulatedThinking = '';
    let liveToolExecutions = [];
    let latestReportedUsage = null;

    await agent.runChat({
      runId,
      messages: payloadForAgent,
      model: currentModelId,
      selectedSkillIds,
      onThinking: (delta) => {
        accumulatedThinking += delta;
        if (currentConversationIdRef.current === streamConvId) {
          setIsReasoningActive(true);
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (last.id !== assistantMsgId) return prev;
            return [
              ...prev.slice(0, lastIdx),
              { ...last, thinkingContent: accumulatedThinking }
            ];
          });
        }
      },
      onContent: (delta) => {
        accumulatedContent += delta;
        if (currentConversationIdRef.current === streamConvId) {
          setIsReasoningActive(false);
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (last.id !== assistantMsgId) return prev;
            return [
              ...prev.slice(0, lastIdx),
              { ...last, content: accumulatedContent, thinkingContent: accumulatedThinking }
            ];
          });
        }
      },
      onStatusChange: (status) => {
        if (currentConversationIdRef.current === streamConvId) {
          setLiveStatus(status);
        }
      },
      onToolStart: (toolCalls) => {
        accumulatedContent = ''; // Clear draft tool JSON arguments
        liveToolExecutions = toolCalls.map(tc => ({
          toolCallId: tc.id,
          toolName: tc.function.name,
          status: 'calling',
          args: tc.function.arguments
        }));
        if (currentConversationIdRef.current === streamConvId) {
          setIsReasoningActive(false);
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (last.id !== assistantMsgId) return prev;
            return [
              ...prev.slice(0, lastIdx),
              { ...last, content: '', tool_calls: toolCalls, toolExecutions: [...liveToolExecutions] }
            ];
          });
        }
      },
      onToolStatus: ({ toolCallId, toolName, status, args }) => {
        liveToolExecutions = liveToolExecutions.map(te =>
          te.toolCallId === toolCallId ? { ...te, status, args } : te
        );
        if (currentConversationIdRef.current === streamConvId) {
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (last.id !== assistantMsgId) return prev;
            return [
              ...prev.slice(0, lastIdx),
              { ...last, toolExecutions: [...liveToolExecutions] }
            ];
          });
        }
      },
      onToolResult: ({ toolCallId, toolName, args, result }) => {
        liveToolExecutions = liveToolExecutions.map(te =>
          te.toolCallId === toolCallId ? { ...te, status: 'completed', args, result } : te
        );
        if (currentConversationIdRef.current === streamConvId) {
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const last = prev[lastIdx];
            if (last.id !== assistantMsgId) return prev;
            return [
              ...prev.slice(0, lastIdx),
              { ...last, toolExecutions: [...liveToolExecutions] }
            ];
          });
        }
      },
      onUsage: (rawUsage) => {
        latestReportedUsage = normalizeApiUsage(rawUsage);
      },
      onDone: async (doneData) => {
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

        // Smart Title generation for first turn via LLM
        if (historyMessages.length === 1 && historyMessages[0].role === 'user') {
          try {
            const titleProvider = createProvider(currentProviderId, activeConfig);
            const generatedTitle = await generateTitleFromPrompt({
              prompt: historyMessages[0].content,
              provider: titleProvider,
              model: currentModelId
            });
            if (generatedTitle && generatedTitle.length >= 2) {
              await LocalDB.saveConversation({
                id: streamConvId,
                title: generatedTitle,
                updatedAt: Date.now()
              });
              setConversations(prev => prev.map(c => c.id === streamConvId ? { ...c, title: generatedTitle } : c));
            }
          } catch (_) {}
        }
      },
      onError: async (err) => {
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
      }
    });
  }, [currentModelId, currentProviderId, providerConfigs, selectedSkillIds]);

  // Send new user message
  const sendMessage = useCallback(async () => {
    const textToSend = input.trim();
    if (!textToSend || !currentModelId || isStreaming) return;

    const userMsg = {
      id: `msg_${Date.now()}_u`,
      conversationId: currentConversationId,
      role: 'user',
      content: textToSend,
      createdAt: Date.now(),
      ordinal: messages.length
    };

    await LocalDB.saveMessage(userMsg);
    setInput('');

    if (messages.length === 0) {
      const initialTitle = cleanFallbackTitle(textToSend);
      await LocalDB.saveConversation({
        id: currentConversationId,
        title: initialTitle,
        updatedAt: Date.now()
      });
      setConversations(prev => prev.map(c => c.id === currentConversationId ? { ...c, title: initialTitle } : c));
    }

    await executeChatStream([...messages, userMsg]);
  }, [input, currentModelId, isStreaming, currentConversationId, messages, executeChatStream]);

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
    selectConversation,
    renameConversation,
    deleteConversation,
    sendMessage,
    stopGeneration,
    regenerate,
    deleteMessage,
    editMessage
  };
}
