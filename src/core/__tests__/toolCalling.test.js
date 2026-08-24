import { describe, it, expect, vi } from 'vitest';
import { WEB_SEARCH_TOOL_DEFINITION, executeWebSearch } from '../tools/webSearch';
import { SYSTEM_TOOLS } from '../tools';
import { AgentCore } from '../agent/agentCore';
import { HttpClient } from '../network/httpClient';

const MOCK_BING_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ol id="b_results">
    <li class="b_algo">
      <h2>
        <a href="https://www.bing.com/ck/a?!&&p=123&u=a1aHR0cHM6Ly9udmlkaWFuZXdzLm52aWRpYS5jb20vbmV3cy9ibGFja3dlbGw&ntb=1">NVIDIA Blackwell News</a>
      </h2>
      <div class="b_caption">
        <p>NVIDIA announced Blackwell architecture GPUs for AI acceleration.</p>
      </div>
    </li>
  </ol>
</body>
</html>
`;

const MOCK_WEBPAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>NVIDIA Blackwell Official Announcement</title></head>
<body>
  <article>
    <h1>NVIDIA Blackwell Platform Drives New Era of Computing</h1>
    <p>SAN JOSE, Calif. — NVIDIA Blackwell architecture delivers massive real-time generative AI performance.</p>
  </article>
</body>
</html>
`;

describe('Universal Web Search & AgentCore Integration', () => {
  it('has valid OpenAI tool definition schema', () => {
    expect(WEB_SEARCH_TOOL_DEFINITION.type).toBe('function');
    expect(WEB_SEARCH_TOOL_DEFINITION.function.name).toBe('web_search');
    expect(WEB_SEARCH_TOOL_DEFINITION.function.parameters.required).toContain('query');
    expect(SYSTEM_TOOLS.length).toBe(1);
    expect(SYSTEM_TOOLS[0].function.name).toBe('web_search');
  });

  it('executes universal web search by discovering URLs and reading full webpage content', async () => {
    // 1st request: Bing HTML SERP
    // 2nd request: Fetch webpage content from https://nvidianews.nvidia.com/news/blackwell
    vi.spyOn(HttpClient, 'request')
      .mockResolvedValueOnce({ ok: true, status: 200, data: MOCK_BING_HTML })
      .mockResolvedValueOnce({ ok: true, status: 200, data: MOCK_WEBPAGE_HTML });

    const toolResult = await executeWebSearch({ query: 'NVIDIA Blackwell news' });

    expect(toolResult).toBeDefined();
    expect(toolResult.query).toBe('NVIDIA Blackwell news');
    expect(toolResult.count).toBe(1);
    expect(toolResult.results[0].url).toBe('https://nvidianews.nvidia.com/news/blackwell');
    expect(toolResult.results[0].content).toContain('NVIDIA Blackwell architecture delivers massive real-time');
    expect(toolResult._note).toContain('untrusted external reference data');
  });

  it('AgentCore handles tool calling loop, receives webpage evidence, and produces synthesized answer', async () => {
    vi.spyOn(HttpClient, 'request')
      .mockResolvedValueOnce({ ok: true, status: 200, data: MOCK_BING_HTML })
      .mockResolvedValueOnce({ ok: true, status: 200, data: MOCK_WEBPAGE_HTML });

    let callCount = 0;
    const mockProvider = {
      chatStream({ messages }) {
        callCount++;
        const currentCount = callCount;
        return (async function* () {
          if (currentCount === 1) {
            // Round 1: Model requests web_search
            yield {
              type: 'chunk',
              reasoning: 'Searching for recent NVIDIA Blackwell announcements.',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_test_search_1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "NVIDIA Blackwell news"}' }
                }
              ]
            };
            yield { type: 'done' };
          } else {
            // Round 2: Model synthesizes answer from fetched webpage content
            yield {
              type: 'chunk',
              content: '根據 NVIDIA 官方公告，Blackwell 架構已正式量產，專為新一代生成式 AI 提供強大推論效能。'
            };
            yield {
              type: 'chunk',
              usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 }
            };
            yield { type: 'done' };
          }
        })();
      }
    };

    const agent = new AgentCore(mockProvider);
    let capturedThinking = '';
    let capturedContent = '';
    let capturedToolStart = null;
    let capturedToolResult = null;
    let doneResult = null;

    await agent.runChat({
      messages: [{ role: 'user', content: 'NVIDIA 最近有什麼重大消息？' }],
      model: 'openai/gpt-oss-120b',
      onThinking: (d) => { capturedThinking += d; },
      onContent: (d) => { capturedContent += d; },
      onToolStart: (tc) => { capturedToolStart = tc; },
      onToolResult: (tr) => { capturedToolResult = tr; },
      onDone: (res) => { doneResult = res; }
    });

    expect(callCount).toBe(2);
    expect(capturedThinking).toContain('Searching for recent NVIDIA Blackwell announcements');
    expect(capturedContent).toContain('根據 NVIDIA 官方公告，Blackwell 架構已正式量產');
    expect(capturedToolStart).toHaveLength(1);
    expect(capturedToolStart[0].function.name).toBe('web_search');
    expect(capturedToolResult.result.results[0].content).toContain('NVIDIA Blackwell architecture');
    expect(doneResult.content).toContain('根據 NVIDIA 官方公告');
    expect(doneResult.toolMessages).toHaveLength(2);
  });
});
