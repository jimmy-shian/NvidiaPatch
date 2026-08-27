import { describe, it, expect, vi } from 'vitest';
import { MCPClientAdapter } from '../protocol/MCPClientAdapter';
import { NativeMCPTransport } from '../NativeMCPTransport';

describe('MCP Modern _meta Protocol Compliance', () => {
  it('includes valid _meta in discover, listTools, and callTool JSON-RPC params', async () => {
    let capturedRequests = [];

    vi.spyOn(NativeMCPTransport, 'execute').mockImplementation(async ({ body }) => {
      capturedRequests.push(body);
      if (body.method === 'tools/call') {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{ type: 'text', text: 'UID 783375644 progress: 100%' }]
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2026-07-28',
            tools: [
              {
                name: 'check_player_progress',
                description: 'Check tower completion progress for UID',
                inputSchema: {
                  type: 'object',
                  properties: { uid: { type: 'string' } }
                }
              }
            ]
          }
        })
      };
    });

    const client = new MCPClientAdapter({
      endpoint: 'https://botsz-tower-check-mcp.hf.space/mcp'
    });

    // 1. Discover
    await client.discover();
    expect(capturedRequests).toHaveLength(1);
    const discReq = capturedRequests[0];
    expect(discReq.params._meta).toBeDefined();
    expect(discReq.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(discReq.params._meta['io.modelcontextprotocol/clientCapabilities']).toBeDefined();
    expect(discReq.params._meta['io.modelcontextprotocol/clientInfo'].name).toBe('NvidiaPatchMobile');

    // 2. List Tools
    await client.listTools();
    expect(capturedRequests).toHaveLength(2);
    const listReq = capturedRequests[1];
    expect(listReq.params._meta).toBeDefined();
    expect(listReq.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');

    // 3. Call Tool
    const toolResult = await client.callTool('check_player_progress', { uid: '783375644' });
    expect(capturedRequests).toHaveLength(3);
    const callReq = capturedRequests[2];
    expect(callReq.params.name).toBe('check_player_progress');
    expect(callReq.params.arguments).toEqual({ uid: '783375644' });
    expect(callReq.params._meta).toBeDefined();
    expect(callReq.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(toolResult.formattedText).toContain('UID 783375644 progress: 100%');
  });
});
