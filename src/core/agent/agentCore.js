/**
 * AgentCore - Mobile AI Agent Controller
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
import { MCPManager } from '../mcp/MCPManager';
import { parseInBandToolCalls } from './inBandToolParser';
import { hasImagesInMessages, repackageMessagesWithoutImages } from '../providers/visionCapabilities';

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
    const safeDone = async (payload) => {
      if (isFinalized || this.activeRunId !== runId) return;
      isFinalized = true;
      await onDone?.({ ...payload, runId });
    };

    const safeError = async (err) => {
      if (isFinalized || this.activeRunId !== runId) return;
      isFinalized = true;
      await onError?.(err, { runId });
    };

    try {
      // Assemble full payload with system prompts, temporal anchor, context, and skills
      let currentMessages = await buildCompleteMessages({
        messages,
        selectedSkillIds,
        model
      });

      if (signal.aborted) {
        await safeDone({ aborted: true });
        return;
      }

      onStatusChange?.({ phase: 'thinking', runId });

      MCPManager.resetTurn();
      const lastUserMsg = (messages || []).filter(m => m.role === 'user').pop()?.content || '';
      let dynamicMcpTools = await MCPManager.getDynamicToolsForPrompt(lastUserMsg, 16);
      let activeTools = [...SYSTEM_TOOLS, ...dynamicMcpTools];

      let round = 0;
      let totalToolCalls = 0;
      let finalContent = '';
      let finalThinking = '';
      let latestUsage = null;
      const allExecutedToolMessages = [];
      const attemptedSearchFingerprints = new Set();

      while (round < AGENT_SAFETY_LIMITS.MAX_TOOL_ROUNDS) {
        if (signal.aborted) {
          await safeDone({ aborted: true });
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
        const toolsToPass = hasBudget ? (round <= 5 ? activeTools : undefined) : undefined;

        const stream = this.provider.chatStream({
          model,
          messages: currentMessages,
          temperature,
          max_tokens,
          signal,
          tools: toolsToPass
        });

        let shouldFallbackObservation = false;

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
            if (round > 1 && allExecutedToolMessages.length > 0) {
              const errMsg = (chunk.delta || '').toLowerCase();
              if (errMsg.includes('tool') || errMsg.includes('400') || errMsg.includes('422') || errMsg.includes('role') || errMsg.includes('schema') || errMsg.includes('連線') || errMsg.includes('fail') || errMsg.includes('abort') || errMsg.includes('reset') || errMsg.includes('closed')) {
                console.warn('[AgentCore] Upstream model rejected native tool schema or connection failed in Round 2, falling back to observation injection...', errMsg);
                const toolResults = allExecutedToolMessages.filter(m => m.role === 'tool');
                const observationText = toolResults.map(t => typeof t.content === 'string' ? t.content : JSON.stringify(t.content)).join('\n\n');
                currentMessages = currentMessages.filter(m => m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls));
                currentMessages.push({
                  role: 'assistant',
                  content: '我已執行搜尋與資料檢索。'
                });
                currentMessages.push({
                  role: 'user',
                  content: `【檢索資料事實如下】:\n${observationText}\n\n請根據以上檢索結果向使用者產出完整回答。`
                });
                totalToolCalls = AGENT_SAFETY_LIMITS.MAX_TOOL_CALLS_PER_RUN; // Prevent further tool calls
                shouldFallbackObservation = true;
                break;
              }
            }
            await safeError(new Error(chunk.delta || 'Stream error'));
            return;
          }
        }

        if (shouldFallbackObservation) {
          continue;
        }

        if (signal.aborted || this.activeRunId !== runId) {
          await safeDone({ aborted: true });
          return;
        }

        reasoningParser.flush();

        // Check if model called any tools in this round (native SSE tool_calls or In-Band <tool_call> tags)
        let validToolCalls = accumulatedToolCalls.filter(tc => Boolean(tc && tc.function?.name));
        let isInBandCall = false;

        if (validToolCalls.length === 0 && hasBudget) {
          const inBandResult = parseInBandToolCalls(roundContent || finalContent);
          if (inBandResult.toolCalls.length > 0) {
            validToolCalls = inBandResult.toolCalls;
            finalContent = inBandResult.cleanedText;
            isInBandCall = true;
          }
        }

        if (validToolCalls.length === 0 || !hasBudget) {
          // If model returned empty content on round 1 with image input, automatically repackage without images and retry
          const trimmed = finalContent.trim();
          if (!trimmed && round === 1 && allExecutedToolMessages.length === 0 && hasImagesInMessages(currentMessages)) {
            console.warn(`[AgentCore] 模型「${model}」接收圖片後未產生任何回覆，自動重發純文字包裝請求...`);
            currentMessages = repackageMessagesWithoutImages(currentMessages, model);
            continue;
          }

          // Clean up if finalContent is merely raw tool call JSON arguments (e.g. { "query": ... })
          const isRawJsonArguments = (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes('"query"')) ||
                                     (trimmed.startsWith('```json') && trimmed.includes('"query"'));

          if (isRawJsonArguments || !trimmed) {
            finalContent = '';
            if (allExecutedToolMessages.length > 0) {
              const toolResults = allExecutedToolMessages.filter(m => m.role === 'tool');
              if (toolResults.length > 0) {
                try {
                  const lastTool = toolResults[toolResults.length - 1];
                  let extractedText = '';
                  if (typeof lastTool.content === 'object' && lastTool.content !== null) {
                    const parsed = lastTool.content;
                    if (parsed.results && parsed.results.length > 0) {
                      const top = parsed.results[0];
                      extractedText = top.content || top.snippet || top.title || '';
                    } else if (parsed.formattedText) {
                      extractedText = parsed.formattedText;
                    } else if (parsed.error) {
                      extractedText = `[工具執行回報]: ${parsed.error}`;
                    }
                  } else if (typeof lastTool.content === 'string') {
                    try {
                      const parsed = JSON.parse(lastTool.content);
                      if (parsed && typeof parsed === 'object') {
                        if (parsed.results && parsed.results.length > 0) {
                          const top = parsed.results[0];
                          extractedText = top.content || top.snippet || top.title || '';
                        } else if (parsed.formattedText) {
                          extractedText = parsed.formattedText;
                        } else if (parsed.error) {
                          extractedText = `[工具執行回報]: ${parsed.error}`;
                        }
                      }
                    } catch (_) {
                      extractedText = lastTool.content;
                    }
                    if (!extractedText) {
                      extractedText = lastTool.content;
                    }
                  }
                  finalContent = extractedText;
                  if (finalContent) {
                    onContent?.(finalContent, { runId });
                  }
                } catch (_) {}
              }
            } else if (hasImagesInMessages(currentMessages)) {
              // If still empty after image retry, show clear failure prompt
              finalContent = `⚠️ 當前模型「${(model || '').split('/').pop()}」不支援圖片解析，且未產生回覆。建議切換至視覺辨識模型（如 Llama 3.2 Vision、GPT-4o、Gemini 等）後再試。`;
              onContent?.(finalContent, { runId });
            }
          }

          // Generation complete!
          onStatusChange?.({ phase: 'completed', runId });
          await safeDone({
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

        if (!isInBandCall) {
          const assistantToolMsg = {
            role: 'assistant',
            content: null,
            tool_calls: validToolCalls
          };
          currentMessages.push(assistantToolMsg);
          allExecutedToolMessages.push(assistantToolMsg);
        } else {
          const assistantInBandMsg = {
            role: 'assistant',
            content: roundContent || '正在調用工具檢索即時資料...'
          };
          currentMessages.push(assistantInBandMsg);
          allExecutedToolMessages.push(assistantInBandMsg);
        }

        for (const tc of validToolCalls) {
          if (signal.aborted || this.activeRunId !== runId) {
            await safeDone({ aborted: true });
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
                    meta: {
                      resultCount: progress.resultCount,
                      pagesToReadCount: progress.pagesToReadCount || progress.count,
                      urls: progress.urls
                    },
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
            await safeDone({ aborted: true });
            return;
          }

          const cleanToolContent = resultPayload?.formattedText
            ? `${resultPayload.instruction || ''}\n\n${resultPayload.formattedText}`
            : (typeof resultPayload === 'string' ? resultPayload : JSON.stringify(resultPayload));

          if (!isInBandCall) {
            // Strict OpenAI / NVIDIA NIM schema: role: 'tool', tool_call_id, content. OMIT 'name'!
            const toolResultMsg = {
              role: 'tool',
              tool_call_id: tc.id,
              content: cleanToolContent
            };
            currentMessages.push(toolResultMsg);
            allExecutedToolMessages.push(toolResultMsg);
          } else {
            // In-band observation injection for models without native function calling
            const observationMsg = {
              role: 'user',
              content: `【工具執行結果 (${toolName})】:\n${cleanToolContent}\n\n請根據以上工具檢索的最新事實，繼續為使用者產出完整回答。`
            };
            currentMessages.push(observationMsg);
            allExecutedToolMessages.push(observationMsg);
          }

          // If new MCP tools were registered, refresh active tools for subsequent rounds
          if (toolName === 'request_mcp_connection' || toolName === 'search_mcp_tools') {
            try {
              const refreshedMcpTools = await MCPManager.getDynamicToolsForPrompt(lastUserMsg, 16);
              activeTools = [...SYSTEM_TOOLS, ...refreshedMcpTools];
            } catch (_) {}
          }

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
            const lastTool = toolResults[toolResults.length - 1];
            let extractedText = '';
            if (typeof lastTool.content === 'object' && lastTool.content !== null) {
              const parsed = lastTool.content;
              if (parsed.results && parsed.results.length > 0) {
                const top = parsed.results[0];
                extractedText = top.content || top.snippet || top.title || '';
              } else if (parsed.formattedText) {
                extractedText = parsed.formattedText;
              } else if (parsed.error) {
                extractedText = `[工具執行回報]: ${parsed.error}`;
              }
            } else if (typeof lastTool.content === 'string') {
              try {
                const parsed = JSON.parse(lastTool.content);
                if (parsed && typeof parsed === 'object') {
                  if (parsed.results && parsed.results.length > 0) {
                    const top = parsed.results[0];
                    extractedText = top.content || top.snippet || top.title || '';
                  } else if (parsed.formattedText) {
                    extractedText = parsed.formattedText;
                  } else if (parsed.error) {
                    extractedText = `[工具執行回報]: ${parsed.error}`;
                  }
                }
              } catch (_) {
                extractedText = lastTool.content;
              }
              if (!extractedText) {
                extractedText = lastTool.content;
              }
            }
            finalContent = extractedText;
            if (finalContent) {
              onContent?.(finalContent, { runId });
            }
          } catch (_) {}
        }
      }

      onStatusChange?.({ phase: 'completed', runId });
      await safeDone({
        content: finalContent,
        thinking: finalThinking,
        usage: latestUsage,
        toolMessages: allExecutedToolMessages
      });
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) {
        await safeDone({ aborted: true });
      } else {
        await safeError(err);
      }
    } finally {
      if (this.activeRunId === runId) {
        this.abortController = null;
        this.activeRunId = null;
      }
    }
  }
}
