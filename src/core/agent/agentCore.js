/**
 * AgentCore - Mobile AI Agent Controller v0.1.8
 * 
 * Features:
 * 1. Run Lifecycle & RunId isolation: Guarantees stale runs and aborted streams do not leak callbacks.
 * 2. Bounded Tool Calling safety limits (MAX_TOOL_ROUNDS = 8, MAX_TOOL_CALLS_PER_RUN = 12).
 * 3. Ephemeral flow progress callbacks (onStatusChange).
 * 4. Multi-tier search retry support & tool error resilience.
 * 5. Clean final synthesis without polluting conversation history with intermediate prompt tokens.
 */
import { buildCompleteMessages } from './promptBuilder';
import { StreamReasoningParser } from './reasoningParser';
import { SYSTEM_TOOLS, executeTool } from '../tools';

export const AGENT_SAFETY_LIMITS = {
  MAX_TOOL_ROUNDS: 8,
  MAX_TOOL_CALLS_PER_RUN: 12
};

export class AgentCore {
  constructor(providerAdapter) {
    this.provider = providerAdapter;
    this.abortController = null;
    this.activeRunId = null;
  }

  setProvider(providerAdapter) {
    this.provider = providerAdapter;
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.activeRunId = null;
  }

  /**
   * Run chat generation stream with full tool calling support
   * @param {Object} params
   */
  async runChat({
    runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    messages,
    model,
    selectedSkillIds = [],
    temperature = 0.7,
    max_tokens = 8192,
    onThinking,
    onContent,
    onToolStart,
    onToolStatus,
    onToolResult,
    onStatusChange,
    onUsage,
    onDone,
    onError
  }) {
    if (!this.provider) {
      onError?.(new Error('No active LLM Provider configured'), { runId });
      return;
    }

    this.abort(); // Cancel any prior active stream
    this.abortController = new AbortController();
    this.activeRunId = runId;
    const signal = this.abortController.signal;

    let isFinalized = false;
    const safeDone = (payload) => {
      if (isFinalized || this.activeRunId !== runId) return;
      isFinalized = true;
      onDone?.({ ...payload, runId });
    };

    const safeError = (err) => {
      if (isFinalized || this.activeRunId !== runId) return;
      isFinalized = true;
      onError?.(err, { runId });
    };

    try {
      // Assemble full payload with system prompts, temporal anchor, context, and skills
      let currentMessages = await buildCompleteMessages({
        messages,
        selectedSkillIds
      });

      if (signal.aborted) {
        safeDone({ aborted: true });
        return;
      }

      onStatusChange?.({ phase: 'thinking', runId });

      let round = 0;
      let totalToolCalls = 0;
      let finalContent = '';
      let finalThinking = '';
      let latestUsage = null;
      const allExecutedToolMessages = [];
      const attemptedSearchFingerprints = new Set();

      while (round < AGENT_SAFETY_LIMITS.MAX_TOOL_ROUNDS) {
        if (signal.aborted) {
          safeDone({ aborted: true });
          return;
        }

        round++;
        let roundContent = '';
        let roundThinking = '';
        const accumulatedToolCalls = [];

        const reasoningParser = new StreamReasoningParser({
          onThinking: (delta) => {
            if (this.activeRunId !== runId || signal.aborted) return;
            roundThinking += delta;
            finalThinking += delta;
            onThinking?.(delta, { runId });
          },
          onContent: (delta) => {
            if (this.activeRunId !== runId || signal.aborted) return;
            roundContent += delta;
            finalContent += delta;
            onContent?.(delta, { runId });
          }
        });

        // Pass tools in earlier rounds; allow final synthesis without re-triggering tools once budget is reached
        const hasBudget = totalToolCalls < AGENT_SAFETY_LIMITS.MAX_TOOL_CALLS_PER_RUN;
        const toolsToPass = hasBudget ? (round <= 3 ? SYSTEM_TOOLS : (round <= 5 ? SYSTEM_TOOLS : undefined)) : undefined;

        const stream = this.provider.chatStream({
          model,
          messages: currentMessages,
          temperature,
          max_tokens,
          signal,
          tools: toolsToPass
        });

        for await (const chunk of stream) {
          if (!chunk || signal.aborted || this.activeRunId !== runId) break;

          // 1. Capture Usage
          if (chunk.usage) {
            latestUsage = chunk.usage;
            onUsage?.(chunk.usage, { runId });
          }

          // 2. Capture Tool Calls
          const rawToolCalls = chunk.tool_calls || (chunk.type === 'tool_call' ? chunk.data : null);
          if (rawToolCalls && Array.isArray(rawToolCalls)) {
            for (const tc of rawToolCalls) {
              const idx = tc.index ?? 0;
              if (!accumulatedToolCalls[idx]) {
                accumulatedToolCalls[idx] = {
                  id: tc.id || `call_${Date.now()}_${idx}`,
                  type: 'function',
                  function: { name: '', arguments: '' }
                };
              }
              if (tc.id) accumulatedToolCalls[idx].id = tc.id;
              if (tc.function?.name) accumulatedToolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
            }
          }

          // 3. Process Reasoning & Content
          reasoningParser.processChunk(chunk);

          // 4. Handle Error
          if (chunk.type === 'error') {
            safeError(new Error(chunk.delta || 'Stream error'));
            return;
          }
        }

        if (signal.aborted || this.activeRunId !== runId) {
          safeDone({ aborted: true });
          return;
        }

        reasoningParser.flush();

        // Check if model called any tools in this round
        const validToolCalls = accumulatedToolCalls.filter(tc => Boolean(tc && tc.function?.name));

        if (validToolCalls.length === 0 || !hasBudget) {
          // Clean up if finalContent is merely raw tool call JSON arguments (e.g. { "query": ... })
          const trimmed = finalContent.trim();
          const isRawJsonArguments = (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes('"query"')) ||
                                     (trimmed.startsWith('```json') && trimmed.includes('"query"'));

          if (isRawJsonArguments || !trimmed) {
            finalContent = '';
            if (allExecutedToolMessages.length > 0) {
              const toolResults = allExecutedToolMessages.filter(m => m.role === 'tool');
              if (toolResults.length > 0) {
                try {
                  const parsed = JSON.parse(toolResults[toolResults.length - 1].content);
                  if (parsed.results && parsed.results.length > 0) {
                    const top = parsed.results[0];
                    finalContent = top.content || top.snippet || top.title || '';
                    onContent?.(finalContent, { runId });
                  }
                } catch (_) {}
              }
            }
          }

          // Generation complete!
          onStatusChange?.({ phase: 'completed', runId });
          safeDone({
            content: finalContent,
            thinking: finalThinking,
            usage: latestUsage,
            toolMessages: allExecutedToolMessages
          });
          return;
        }

        // --- Model requested Tool Calls ---
        finalContent = ''; // Reset draft function call JSON
        totalToolCalls += validToolCalls.length;
        onToolStart?.(validToolCalls, { runId });

        const assistantToolMsg = {
          role: 'assistant',
          content: null,
          tool_calls: validToolCalls
        };
        currentMessages.push(assistantToolMsg);
        allExecutedToolMessages.push(assistantToolMsg);

        for (const tc of validToolCalls) {
          if (signal.aborted || this.activeRunId !== runId) {
            safeDone({ aborted: true });
            return;
          }

          const toolName = tc.function.name;
          let parsedArgs = {};
          try {
            parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch (_) {
            parsedArgs = { query: tc.function.arguments || '' };
          }

          onToolStatus?.({
            toolCallId: tc.id,
            toolName,
            status: 'executing',
            args: parsedArgs
          }, { runId });

          if (toolName === 'web_search') {
            onStatusChange?.({
              phase: 'searching',
              meta: { query: parsedArgs.query || '' },
              runId
            });
          } else {
            onStatusChange?.({
              phase: 'using_tool',
              meta: { toolName },
              runId
            });
          }

          let resultPayload;
          try {
            resultPayload = await executeTool(toolName, parsedArgs, {
              signal,
              attemptedFingerprints: attemptedSearchFingerprints,
              onProgress: (progress) => {
                if (this.activeRunId !== runId || signal.aborted) return;
                if (progress.phase === 'reading') {
                  onStatusChange?.({
                    phase: 'reading',
                    meta: { count: progress.count, urls: progress.urls },
                    runId
                  });
                } else if (progress.phase === 'retrying_query') {
                  onStatusChange?.({
                    phase: 'retrying_query',
                    meta: { originalQuery: progress.originalQuery, relaxedQuery: progress.relaxedQuery },
                    runId
                  });
                }
              }
            });
          } catch (toolErr) {
            resultPayload = {
              error: toolErr.message || 'Tool execution failed',
              tip: 'Synthesize answer based on remaining facts or advise user.'
            };
          }

          if (signal.aborted || this.activeRunId !== runId) {
            safeDone({ aborted: true });
            return;
          }

          const toolResultMsg = {
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: typeof resultPayload === 'string' ? resultPayload : JSON.stringify(resultPayload)
          };

          currentMessages.push(toolResultMsg);
          allExecutedToolMessages.push(toolResultMsg);

          onToolResult?.({
            toolCallId: tc.id,
            toolName,
            args: parsedArgs,
            result: resultPayload
          }, { runId });

          onStatusChange?.({ phase: 'organizing', runId });
        }
      }

      // If max rounds reached without final answer, synthesize fallback from tool evidence
      if (!finalContent.trim() && allExecutedToolMessages.length > 0) {
        const toolResults = allExecutedToolMessages.filter(m => m.role === 'tool');
        if (toolResults.length > 0) {
          try {
            const parsed = JSON.parse(toolResults[toolResults.length - 1].content);
            if (parsed.results && parsed.results.length > 0) {
              const top = parsed.results[0];
              finalContent = top.content || top.snippet || top.title || '';
              onContent?.(finalContent, { runId });
            }
          } catch (_) {}
        }
      }

      onStatusChange?.({ phase: 'completed', runId });
      safeDone({
        content: finalContent,
        thinking: finalThinking,
        usage: latestUsage,
        toolMessages: allExecutedToolMessages
      });
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) {
        safeDone({ aborted: true });
      } else {
        safeError(err);
      }
    } finally {
      if (this.activeRunId === runId) {
        this.abortController = null;
        this.activeRunId = null;
      }
    }
  }
}
