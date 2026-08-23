import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LocalDB } from '../core/storage/localDatabase';
import { AgentCore } from '../core/agent/agentCore';
import { createProvider } from '../core/providers';
import { ContextCompressor } from '../core/context/contextCompressor';
import { estimateFullContextTokens } from '../core/context/tokenManager';
import { getModelContextLimit, AUTO_COMPRESSION_THRESHOLD } from '../core/context/modelLimits';

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

  // Load messages and skill settings when current conversation changes
  useEffect(() => {
    if (!currentConversationId) return;
    async function loadMessages() {
      const msgs = await LocalDB.getMessages(currentConversationId);
      setMessages(msgs);

      const conv = await LocalDB.getConversation(currentConversationId);
      if (conv?.skillIds) {
        setSelectedSkillIds(conv.skillIds);
      }
    }
    loadMessages();
  }, [currentConversationId]);

  // Calculate live Context Token usage & Model limit
  const contextStats = useMemo(() => {
    const maxTokens = getModelContextLimit(currentModelId);
    const estimate = estimateFullContextTokens({
      systemPrompt: 'NvidiaPatch Chat Base System Prompt + Personal Context + Skills',
      messages,
      currentInput: input
    });

    const usedTokens = estimate.totalTokens;
    const isNearLimit = usedTokens >= AUTO_COMPRESSION_THRESHOLD - 500;
    const isOverThreshold = usedTokens >= AUTO_COMPRESSION_THRESHOLD;

    return {
      usedTokens,
      maxTokens,
      isNearLimit,
      isOverThreshold,
      autoThreshold: AUTO_COMPRESSION_THRESHOLD
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

  // Select conversation
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
        // Re-estimate after compression
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

    // 1. Check Automatic Context Compression (> 6000 tokens)
    const currentTokens = estimateFullContextTokens({
      systemPrompt: 'System',
      messages: historyMessages
    }).totalTokens;

    if (currentTokens >= AUTO_COMPRESSION_THRESHOLD && historyMessages.length >= 4) {
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

    // 2. Build model request messages (uses compressed summary if available, preserving recent messages)
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
      createdAt: Date.now() + 1
    };

    setMessages([...historyMessages, assistantMsg]);
    setIsStreaming(true);
    setIsReasoningActive(true);

    const agent = new AgentCore(provider);
    agentCoreRef.current = agent;

    const payloadForAgent = modelRequestMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    let accumulatedContent = '';
    let accumulatedThinking = '';

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
            {
              ...last,
              thinkingContent: accumulatedThinking
            }
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
            {
              ...last,
              content: accumulatedContent,
              thinkingContent: accumulatedThinking
            }
          ];
        });
      },
      onDone: async () => {
        setIsStreaming(false);
        setIsReasoningActive(false);
        await LocalDB.saveMessage({
          ...assistantMsg,
          content: accumulatedContent,
          thinkingContent: accumulatedThinking
        });

        // Smart Title generation for first turn via LLM
        if (historyMessages.length === 1 && historyMessages[0].role === 'user') {
          try {
            const titleMessages = [
              { role: 'system', content: '你是一個對話標題生成助手。請用 4 到 8 個繁體中文字簡短概括對話主題，嚴禁標點符號、句號、引號或任何額外前綴，直接輸出標題文字。' },
              { role: 'user', content: `使用者問題：${historyMessages[0].content}\n回答摘要：${accumulatedContent.slice(0, 120)}` }
            ];
            const titleProvider = createProvider(currentProviderId, activeConfig);
            const titleStream = titleProvider.chatStream({
              model: currentModelId,
              messages: titleMessages,
              temperature: 0.3,
              max_tokens: 30
            });
            let generatedTitle = '';
            for await (const tChunk of titleStream) {
              if (tChunk.type === 'content') generatedTitle += tChunk.delta;
            }
            const cleanTitle = generatedTitle.replace(/["'「」『』\n\r。.]/g, '').trim().slice(0, 16);
            if (cleanTitle && cleanTitle.length >= 2) {
              await LocalDB.saveConversation({
                id: currentConversationId,
                title: cleanTitle,
                updatedAt: Date.now()
              });
              setConversations(prev => prev.map(c => c.id === currentConversationId ? { ...c, title: cleanTitle } : c));
            }
          } catch (_) {}
        }
      },
      onError: async (err) => {
        setIsStreaming(false);
        setIsReasoningActive(false);
        const errMsg = `\n[錯誤]: ${err.message}`;
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              content: (last.content || '') + errMsg,
              thinkingContent: accumulatedThinking
            }
          ];
        });
        await LocalDB.saveMessage({
          ...assistantMsg,
          content: accumulatedContent + errMsg,
          thinkingContent: accumulatedThinking
        });
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
      createdAt: Date.now()
    };

    await LocalDB.saveMessage(userMsg);
    setInput('');

    // Temporary title placeholder until LLM generates smart title
    if (messages.length === 0) {
      const initialTitle = textToSend.slice(0, 15);
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
    // Invalidate summary if deleted message was inside summarized scope
    await ContextCompressor.invalidateSummaryIfNeeded(currentConversationId, msgId, messages);
  }, [currentConversationId, messages]);

  // Edit message & Re-trigger model call if user message
  const editMessage = useCallback(async (msgId, newContent) => {
    const targetIdx = messages.findIndex(m => m.id === msgId);
    if (targetIdx === -1) return;

    const targetMsg = messages[targetIdx];
    const updatedMsg = { ...targetMsg, content: newContent };

    await LocalDB.updateMessage(msgId, { content: newContent });

    if (targetMsg.role === 'user') {
      // Invalidate existing summary if edited message was within summary
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
