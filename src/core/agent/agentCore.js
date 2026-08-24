/**
 * AgentCore - Mobile AI Agent Controller
 * 
 * Features:
 * 1. Full OpenAI Function Calling loop (supports multiple tool calls per turn and multi-round search).
 * 2. Streaming accumulation for delta.tool_calls, delta.reasoning_content, delta.content.
 * 3. Tool lifecycle callbacks (onToolStart, onToolStatus, onToolResult).
 * 4. Full OpenAI message chain construction (assistant tool_calls -> tool role responses -> final assistant response).
 */
import { buildCompleteMessages } from './promptBuilder';
import { StreamReasoningParser } from './reasoningParser';
import { SYSTEM_TOOLS, executeTool } from '../tools';

export class AgentCore {
  constructor(providerAdapter) {
    this.provider = providerAdapter;
    this.abortController = null;
  }

  setProvider(providerAdapter) {
    this.provider = providerAdapter;
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Run chat generation stream with full tool calling support
   * @param {Object} params
   */
  async runChat({
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
    onUsage,
    onDone,
    onError
  }) {
    if (!this.provider) {
      onError?.(new Error('No active LLM Provider configured'));
      return;
    }

    this.abortController = new AbortController();

    try {
      // Assemble full payload with system prompts, context, and skills
      let currentMessages = await buildCompleteMessages({
        messages,
        selectedSkillIds
      });

      const MAX_TOOL_ROUNDS = 5;
      let round = 0;
      let finalContent = '';
      let finalThinking = '';
      let latestUsage = null;
      const allExecutedToolMessages = [];

      while (round < MAX_TOOL_ROUNDS) {
        round++;
        let roundContent = '';
        let roundThinking = '';
        const accumulatedToolCalls = [];

        const reasoningParser = new StreamReasoningParser({
          onThinking: (delta) => {
            roundThinking += delta;
            finalThinking += delta;
            onThinking?.(delta);
          },
          onContent: (delta) => {
            roundContent += delta;
            finalContent += delta;
            onContent?.(delta);
          }
        });

        const stream = this.provider.chatStream({
          model,
          messages: currentMessages,
          temperature,
          max_tokens,
          signal: this.abortController.signal,
          tools: SYSTEM_TOOLS
        });

        for await (const chunk of stream) {
          if (!chunk) continue;

          // 1. Capture Usage
          if (chunk.usage) {
            latestUsage = chunk.usage;
            onUsage?.(chunk.usage);
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
            onError?.(new Error(chunk.delta || 'Stream error'));
            return;
          }
        }

        reasoningParser.flush();

        // Check if model called any tools in this round
        const validToolCalls = accumulatedToolCalls.filter(tc => Boolean(tc && tc.function?.name));

        if (validToolCalls.length === 0) {
          // No more tool calls: generation complete!
          onDone?.({
            content: finalContent,
            thinking: finalThinking,
            usage: latestUsage,
            toolMessages: allExecutedToolMessages
          });
          return;
        }

        // --- Execute Tool Calls ---
        onToolStart?.(validToolCalls);

        const assistantToolMsg = {
          role: 'assistant',
          content: roundContent || null,
          tool_calls: validToolCalls
        };
        currentMessages.push(assistantToolMsg);
        allExecutedToolMessages.push(assistantToolMsg);

        for (const tc of validToolCalls) {
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
          });

          let resultPayload;
          try {
            resultPayload = await executeTool(toolName, parsedArgs);
          } catch (toolErr) {
            resultPayload = { error: toolErr.message || 'Tool execution failed' };
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
          });
        }
      }

      onDone?.({
        content: finalContent,
        thinking: finalThinking,
        usage: latestUsage,
        toolMessages: allExecutedToolMessages
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        onDone?.({ aborted: true });
      } else {
        onError?.(err);
      }
    } finally {
      this.abortController = null;
    }
  }
}
