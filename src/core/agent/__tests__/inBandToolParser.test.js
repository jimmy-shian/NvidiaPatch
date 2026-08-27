import { describe, it, expect } from 'vitest';
import { parseInBandToolCalls } from '../inBandToolParser';

describe('In-Band Tool Call Parser', () => {
  it('parses XML style <tool_call> tags (Nemotron / ChatML format)', () => {
    const rawContent = `I need to search for Jimmy Hsiung on GitHub.

<tool_call>
<function=web_search>
<parameter=query>
"Jimmy Hsiung" github
</parameter>
</function>
</tool_call>`;

    const { toolCalls, cleanedText } = parseInBandToolCalls(rawContent);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('web_search');
    const parsedArgs = JSON.parse(toolCalls[0].function.arguments);
    expect(parsedArgs.query).toBe('"Jimmy Hsiung" github');
    expect(cleanedText).toBe('I need to search for Jimmy Hsiung on GitHub.');
  });

  it('parses XML style with attributes <function name="...">', () => {
    const rawContent = `Connecting to MCP server:
<tool_call>
<function name="request_mcp_connection">
<parameter name="url">https://botsz-tower-check-mcp.hf.space/mcp</parameter>
<parameter name="reason">Check monthly mission progress</parameter>
</function>
</tool_call>`;

    const { toolCalls, cleanedText } = parseInBandToolCalls(rawContent);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('request_mcp_connection');
    const parsedArgs = JSON.parse(toolCalls[0].function.arguments);
    expect(parsedArgs.url).toBe('https://botsz-tower-check-mcp.hf.space/mcp');
    expect(parsedArgs.reason).toBe('Check monthly mission progress');
    expect(cleanedText).toBe('Connecting to MCP server:');
  });

  it('parses JSON format inside <tool_call>', () => {
    const rawContent = `Invoking tool:
<tool_call>
{"name": "mcp__srv123__check_player_progress", "arguments": {"uid": 783375644}}
</tool_call>`;

    const { toolCalls, cleanedText } = parseInBandToolCalls(rawContent);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('mcp__srv123__check_player_progress');
    const parsedArgs = JSON.parse(toolCalls[0].function.arguments);
    expect(parsedArgs.uid).toBe(783375644);
    expect(cleanedText).toBe('Invoking tool:');
  });

  it('parses markdown code block ```tool_call', () => {
    const rawContent = `Let me query:
\`\`\`tool_call
{"name": "search_mcp_tools", "arguments": {"query": "tower"}}
\`\`\``;

    const { toolCalls, cleanedText } = parseInBandToolCalls(rawContent);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('search_mcp_tools');
    const parsedArgs = JSON.parse(toolCalls[0].function.arguments);
    expect(parsedArgs.query).toBe('tower');
    expect(cleanedText).toBe('Let me query:');
  });

  it('returns empty array when no tool calls are present', () => {
    const rawContent = 'This is regular text response without any tool calls.';
    const { toolCalls, cleanedText } = parseInBandToolCalls(rawContent);
    expect(toolCalls).toHaveLength(0);
    expect(cleanedText).toBe('This is regular text response without any tool calls.');
  });
});
