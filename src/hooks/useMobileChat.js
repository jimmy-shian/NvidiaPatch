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
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReasoningActive, setIsReasoningActive] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionToast, setCompressionToast] = useState(null);

  const agentCoreRef = useRef(null);
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

  // Load messages and skill settings with Anti-Race Condition Generation Protection
  useEffect(() => {
    if (!currentConversationId) return;

    const currentGen = ++loadMessagesGenRef.current;

    async function loadMessages() {
      const msgs = await LocalDB.getMessages(currentConversationId);
      if (loadMessagesGenRef.current !== currentGen) return; // Stale query discarded

      setMessages(msgs);

      const conv = await LocalDB.getConversation(currentConversationId);
      if (loadMessagesGenRef.current !== currentGen) return;

      if (conv?.skillIds) {
        setSelectedSkillIds(conv.skillIds);
      }
    }
    loadMessages();
  }, [currentConversationId]);

  // Calculate live Context Token usage & Model limit (API usage baseline + Preflight Projection)
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
  }, [currentModelId, messages, input]);

  // Create new conversation
  const newChat = useCallback(async () => {
    if (isStreaming) agentCoreRef.current?.abort();

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
  }, [currentProviderId, currentModelId, selectedSkillIds, isStreaming]);

  // Select conversation with generation check
  const selectConversation = useCallback((convId) => {
    if (isStreaming) agentCoreRef.current?.abort();
    setCurrentConversationId(convId);
  }, [isStreaming]);

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
    await LocalDB.deleteConversation(convId);
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
    if (messages.length < 3 || isCompressing || isStreaming) return;
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
    if (!currentModelId || historyMessages.length === 0) return;

    const activeConfig = providerConfigs[currentProviderId] || {};
    const provider = createProvider(currentProviderId, activeConfig);

    // 1. Dynamic 80% Context Compression check
    const compressionThreshold = getCompressionThreshold(currentModelId);
    const currentTokens = estimateFullContextTokens({
      systemPrompt: 'System',
      messages: historyMessages
    }).totalTokens;

    if (currentTokens >= compressionThreshold && historyMessages.length >= 4) {
      setIsCompressing(true);
      try {
        await ContextCompressor.compressIfNeeded({
          conversationId: currentConversationId,
          messages: historyMessages,
          provider,
          model: currentModelId,
          force: false
        });
      } catch (compErr) {
        console.warn('[Auto compression failed, proceeding with standard request]:', compErr);
      } finally {
        setIsCompressing(false);
      }
    }

    // 2. Build model request messages (uses compressed summary if available)
    const modelRequestMessages = await ContextCompressor.buildRequestContextMessages({
      conversationId: currentConversationId,
      messages: historyMessages
    });

    const assistantMsg = {
      id: `msg_${Date.now()}_a`,
      conversationId: currentConversationId,
      role: 'assistant',
      modelName: currentModelId.split('/').pop(),
      content: '',
      thinkingContent: '',
      tool_calls: null,
      toolExecutions: [], // Live UI state: [{ toolCallId, toolName, status, args, result }]
      createdAt: Date.now() + 1,
      ordinal: historyMessages.length
    };

    setMessages([...historyMessages, assistantMsg]);
    setIsStreaming(true);
    setIsReasoningActive(true);

    const agent = new AgentCore(provider);
    agentCoreRef.current = agent;

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
      messages: payloadForAgent,
      model: currentModelId,
      selectedSkillIds,
      onThinking: (delta) => {
        setIsReasoningActive(true);
        accumulatedThinking += delta;
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            { ...last, thinkingContent: accumulatedThinking }
          ];
        });
      },
      onContent: (delta) => {
        setIsReasoningActive(false);
        accumulatedContent += delta;
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            { ...last, content: accumulatedContent, thinkingContent: accumulatedThinking }
          ];
        });
      },
      onToolStart: (toolCalls) => {
        setIsReasoningActive(false);
        liveToolExecutions = toolCalls.map(tc => ({
          toolCallId: tc.id,
          toolName: tc.function.name,
          status: 'calling',
          args: tc.function.arguments
        }));
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            { ...last, tool_calls: toolCalls, toolExecutions: [...liveToolExecutions] }
          ];
        });
      },
      onToolStatus: ({ toolCallId, toolName, status, args }) => {
        liveToolExecutions = liveToolExecutions.map(te =>
          te.toolCallId === toolCallId ? { ...te, status, args } : te
        );
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            { ...last, toolExecutions: [...liveToolExecutions] }
          ];
        });
      },
      onToolResult: ({ toolCallId, toolName, args, result }) => {
        liveToolExecutions = liveToolExecutions.map(te =>
          te.toolCallId === toolCallId ? { ...te, status: 'completed', args, result } : te
        );
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            { ...last, toolExecutions: [...liveToolExecutions] }
          ];
        });
      },
      onUsage: (rawUsage) => {
        latestReportedUsage = normalizeApiUsage(rawUsage);
      },
      onDone: async (doneData) => {
        setIsStreaming(false);
        setIsReasoningActive(false);

        const finalNormalizedUsage = doneData?.usage ? normalizeApiUsage(doneData.usage) : latestReportedUsage;

        const finalAssistantMsg = {
          ...assistantMsg,
          content: accumulatedContent,
          thinkingContent: accumulatedThinking,
          tool_calls: assistantMsg.tool_calls || null,
          toolExecutions: liveToolExecutions,
          usage: finalNormalizedUsage
        };

        // Transactionally save all generated tool messages and assistant responses
        const msgsToPersist = [];
        if (doneData?.toolMessages && doneData.toolMessages.length > 0) {
          doneData.toolMessages.forEach((tm, idx) => {
            msgsToPersist.push({
              id: `msg_${Date.now()}_tm_${idx}`,
              conversationId: currentConversationId,
              role: tm.role,
              content: tm.content,
              tool_calls: tm.tool_calls || null,
              tool_call_id: tm.tool_call_id || null,
              name: tm.name || null,
              createdAt: Date.now() + idx,
              ordinal: historyMessages.length + idx
            });
          });
        }
        msgsToPersist.push(finalAssistantMsg);

        await LocalDB.saveMessages(msgsToPersist);

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
                id: currentConversationId,
                title: generatedTitle,
                updatedAt: Date.now()
              });
              setConversations(prev => prev.map(c => c.id === currentConversationId ? { ...c, title: generatedTitle } : c));
            }
          } catch (_) {}
        }
      },
      onError: async (err) => {
        setIsStreaming(false);
        setIsReasoningActive(false);
        const errMsg = `\n[錯誤]: ${err.message}`;
        const finalAssistantMsg = {
          ...assistantMsg,
          content: (accumulatedContent || '') + errMsg,
          thinkingContent: accumulatedThinking,
          toolExecutions: liveToolExecutions
        };
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            finalAssistantMsg
          ];
        });
        await LocalDB.saveMessage(finalAssistantMsg);
      }
    });
  }, [currentModelId, currentConversationId, currentProviderId, providerConfigs, selectedSkillIds]);

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

  // Stop Generation
  const stopGeneration = useCallback(() => {
    if (agentCoreRef.current) {
      agentCoreRef.current.abort();
    }
    setIsStreaming(false);
    setIsReasoningActive(false);
  }, []);

  // Regenerate / Retry response
  const regenerate = useCallback(async () => {
    if (messages.length === 0 || isStreaming) return;

    let baseHistory = [...messages];
    const lastMsg = baseHistory[baseHistory.length - 1];

    if (lastMsg.role === 'assistant') {
      await LocalDB.deleteMessage(lastMsg.id);
      baseHistory = baseHistory.slice(0, -1);
    }

    if (baseHistory.length === 0) return;

    await executeChatStream(baseHistory);
  }, [messages, isStreaming, executeChatStream]);

  // Delete message
  const deleteMessage = useCallback(async (msgId) => {
    await LocalDB.deleteMessage(msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    await ContextCompressor.invalidateSummaryIfNeeded(currentConversationId, msgId, messages);
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
    isStreaming,
    isReasoningActive,
    isCompressing,
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
