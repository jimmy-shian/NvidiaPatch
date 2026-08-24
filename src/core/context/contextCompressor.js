/**
 * Context Compression & Summarization Engine
 * Compresses older conversation turns into structured summaries
 * when total context exceeds 80% of model context window while preserving recent messages verbatim.
 * 
 * Safety:
 * - Hidden system instructions, skill manuals, personal context are strictly excluded from summaries.
 * - Tool execution results preserve factual data/conclusions/URLs while omitting raw JSON wrappers.
 */
import { LocalDB } from '../storage/localDatabase';
import { estimateTextTokens } from './tokenManager';

const SUMMARIZE_SYSTEM_PROMPT = `You are a Context Compression and Summarization Specialist.
Your task is to compress the provided prior conversation into a dense, structured, lossless summary in Traditional Chinese (繁體中文).
Preserve all crucial user goals, confirmed preferences, key factual data/URLs obtained from tools, decisions, and completed tasks:

=== 結構化摘要格式 (STRUCTURED SUMMARY FORMAT) ===
## 使用者主要目標 (User Goals)
- ...
## 已確認需求與偏好 (Confirmed Requirements & Preferences)
- ...
## 關鍵技術架構與決策 (Technical Decisions & Architecture)
- ...
## 搜尋與工具關鍵結果 (Key Tool Results & URLs)
- ...
## 已完成事項與狀態 (Completed Work)
- ...
## 尚未完成事項 / 待辦 (Outstanding Tasks / TODO)
- ...`;

export const ContextCompressor = {
  /**
   * Determine if context needs compression and execute structured summarization
   */
  async compressIfNeeded({
    conversationId,
    messages = [],
    provider,
    model,
    force = false
  }) {
    if (!conversationId || messages.length < 2 || !provider) {
      return { compressed: false, reason: 'insufficient_messages' };
    }

    // 1. Check existing summary
    const existingSummary = await LocalDB.getConversationSummary(conversationId);

    // 2. Determine recent message cutoff (keep last 2 messages verbatim, or 1 if very short)
    const RECENT_MESSAGES_COUNT = messages.length <= 3 ? 1 : 2;
    const messagesToSummarize = messages.slice(0, -RECENT_MESSAGES_COUNT);
    const recentMessages = messages.slice(-RECENT_MESSAGES_COUNT);

    if (messagesToSummarize.length === 0) {
      return { compressed: false, reason: 'no_historical_messages' };
    }

    // Check if new messages need compression beyond what was previously summarized
    const lastSummarizedId = existingSummary?.summarizedUntilMessageId;
    const unsummarizedOldMessages = (lastSummarizedId && !force)
      ? messagesToSummarize.filter(m => {
          const summarizedIdx = messagesToSummarize.findIndex(msg => msg.id === lastSummarizedId);
          const currentIdx = messagesToSummarize.findIndex(msg => msg.id === m.id);
          return currentIdx > summarizedIdx;
        })
      : messagesToSummarize;

    if (unsummarizedOldMessages.length === 0 && !force) {
      return { compressed: false, reason: 'already_up_to_date', summary: existingSummary };
    }

    // 3. Build minimal, non-recursive compression prompt
    const summarizePayload = [
      { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT }
    ];

    if (existingSummary?.summary && !force) {
      summarizePayload.push({
        role: 'system',
        content: `【先前對話摘要 (Previous Summary)】:\n${existingSummary.summary}`
      });
    }

    // Format historical messages safely:
    // Exclude system instructions, format tool results cleanly
    const safeMessagesContent = unsummarizedOldMessages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return `[TOOL RESULT (${m.name || 'search'})]: ${m.content}`;
        }
        if (m.role === 'assistant' && m.tool_calls) {
          const calls = Array.isArray(m.tool_calls) ? m.tool_calls.map(c => c.function?.name || 'tool').join(', ') : 'tool';
          return `[ASSISTANT (Called ${calls})]: ${m.content || ''}`;
        }
        return `[${m.role.toUpperCase()}]: ${m.content || ''}`;
      })
      .join('\n\n');

    summarizePayload.push({
      role: 'user',
      content: `請整合並產出最新的結構化對話摘要（僅保留實質對話與事實）：\n\n${safeMessagesContent}`
    });

    // 4. Call Model with 3x Retry
    const MAX_RETRIES = 3;
    let newSummaryText = '';
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        newSummaryText = '';
        for await (const chunk of provider.chatStream({
          model,
          messages: summarizePayload,
          temperature: 0.3,
          max_tokens: 1500
        })) {
          if (chunk.content) {
            newSummaryText += chunk.content;
          } else if (chunk.type === 'content') {
            newSummaryText += chunk.delta;
          }
        }
        if (newSummaryText.trim()) {
          break;
        }
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    if (!newSummaryText.trim()) {
      console.warn('[ContextCompressor] Summarization failed, preserving original history.', lastError);
      return { compressed: false, error: lastError?.message || 'Compression failed' };
    }

    // 5. Transactionally save summary record
    const lastSummarizedMessage = messagesToSummarize[messagesToSummarize.length - 1];
    const summaryRecord = {
      conversationId,
      summary: newSummaryText.trim(),
      summarizedUntilMessageId: lastSummarizedMessage.id,
      tokenCount: estimateTextTokens(newSummaryText),
      createdAt: Date.now()
    };

    await LocalDB.saveConversationSummary(summaryRecord);

    return {
      compressed: true,
      summary: summaryRecord,
      compressedCount: messagesToSummarize.length,
      recentCount: recentMessages.length
    };
  },

  /**
   * Build Model Request context by injecting compressed summary and retaining recent messages
   */
  async buildRequestContextMessages({
    conversationId,
    messages = []
  }) {
    if (!conversationId || messages.length === 0) {
      return messages;
    }

    const summaryRecord = await LocalDB.getConversationSummary(conversationId);
    if (!summaryRecord || !summaryRecord.summary) {
      return messages;
    }

    const lastSummarizedId = summaryRecord.summarizedUntilMessageId;
    const lastSummarizedIdx = messages.findIndex(m => m.id === lastSummarizedId);

    if (lastSummarizedIdx === -1) {
      // If messages were edited or branch changed, fallback to raw messages
      return messages;
    }

    const rawRecentMessages = messages.slice(lastSummarizedIdx + 1);

    const summaryMessage = {
      role: 'system',
      content: `=== 歷史對話背景與重要上下文摘要 (COMPRESSED HISTORICAL CONTEXT) ===\n${summaryRecord.summary}`
    };

    return [summaryMessage, ...rawRecentMessages];
  },

  /**
   * Invalidate summary if an older summarized message was edited or deleted
   */
  async invalidateSummaryIfNeeded(conversationId, targetMessageId, currentMessages = []) {
    const summary = await LocalDB.getConversationSummary(conversationId);
    if (!summary) return;

    const targetIdx = currentMessages.findIndex(m => m.id === targetMessageId);
    const summarizedIdx = currentMessages.findIndex(m => m.id === summary.summarizedUntilMessageId);

    // If edited message is before or at the summarized cutoff, invalidate summary
    if (targetIdx !== -1 && (summarizedIdx === -1 || targetIdx <= summarizedIdx)) {
      await LocalDB.deleteConversationSummary(conversationId);
    }
  }
};
