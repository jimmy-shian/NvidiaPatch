/**
 * MCP Core Engine & Security Policy Unit Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateMcpUrl, isPrivateOrReservedIp, canonicalizeEndpoint } from '../policies/MCPURLValidator';
import { canonicalJsonStringify, computeCanonicalHash, generateServerId, MCPToolCatalog } from '../MCPToolCatalog';
import { MCPProviderSchemaAdapter } from '../protocol/MCPProviderSchemaAdapter';
import { MCPResponseNormalizer, parseMcpResponsePayload } from '../protocol/MCPResponseNormalizer';
import { MCPToolSelector } from '../MCPToolSelector';
import { MCPConnectionPolicy, MCPTrustLevel } from '../policies/MCPConnectionPolicy';
import { MCPToolPolicy, ToolRiskLevel } from '../policies/MCPToolPolicy';
import { MCPInteractionCoordinator, MAX_MRTR_ROUNDS } from '../MCPInteractionCoordinator';
import { NativeMCPTransport } from '../NativeMCPTransport';
import { LocalDB } from '../../storage/localDatabase';
import { MCPManager } from '../MCPManager';

describe('MCP URL & SSRF Validator', () => {
  it('allows valid public HTTPS endpoints', () => {
    const res = validateMcpUrl('https://botsz-tower-check-mcp.hf.space/mcp');
    expect(res.valid).toBe(true);
    expect(res.parsedUrl.hostname).toBe('botsz-tower-check-mcp.hf.space');
  });

  it('rejects HTTP by default for production safety', () => {
    const res = validateMcpUrl('http://example.com/mcp');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('僅允許 HTTPS');
  });

  it('allows HTTP if allowLocalNetwork is explicitly true', () => {
    const res = validateMcpUrl('http://192.168.1.50:8080/mcp', { allowLocalNetwork: true });
    expect(res.valid).toBe(true);
  });

  it('rejects URLs with embedded credentials', () => {
    const res = validateMcpUrl('https://admin:secret@api.example.com/mcp');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('帳號密碼憑證');
  });

  it('blocks private IPv4 and loopback addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
  });

  it('blocks private IPv6 addresses & IPv4-mapped IPv6', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
  });

  it('canonicalizes endpoint URLs correctly', () => {
    expect(canonicalizeEndpoint('https://api.example.com/mcp/')).toBe('https://api.example.com/mcp');
    expect(canonicalizeEndpoint('https://api.example.com/mcp?v=1')).toBe('https://api.example.com/mcp?v=1');
  });
});

describe('Canonical JSON & Schema Drift Detection', () => {
  it('produces identical hash regardless of key ordering', () => {
    const objA = { b: 2, a: 1, c: { z: 26, y: 25 } };
    const objB = { a: 1, c: { y: 25, z: 26 }, b: 2 };

    const canonicalA = canonicalJsonStringify(objA);
    const canonicalB = canonicalJsonStringify(objB);

    expect(canonicalA).toBe(canonicalB);
    expect(computeCanonicalHash(objA)).toBe(computeCanonicalHash(objB));
  });

  it('generates consistent 12-char server ID', () => {
    const id1 = generateServerId('https://botsz-tower-check-mcp.hf.space/mcp', 'bearer');
    const id2 = generateServerId('https://botsz-tower-check-mcp.hf.space/mcp', 'bearer');
    expect(id1).toBe(id2);
    expect(id1.length).toBe(12);
  });

  it('detects schema drift and invalidates approval when inputSchema changes', () => {
    const serverId = 'a83cf928b12e';
    const oldTools = [
      {
        name: 'tower_check_completion',
        inputSchema: { type: 'object', properties: { taskId: { type: 'string' } } },
        toolSchemaHash: 'hash_old_123'
      }
    ];

    const newRawTools = [
      {
        name: 'tower_check_completion',
        description: 'Updated description',
        inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, extraField: { type: 'boolean' } } }
      }
    ];

    const { processedTools, schemaDriftDetected } = MCPToolCatalog.processServerTools(
      serverId,
      newRawTools,
      { tower_check_completion: oldTools[0] }
    );

    expect(schemaDriftDetected).toBe(true);
    expect(processedTools[0].approvalValid).toBe(false);
  });
});

describe('MCP Provider Schema Adapter', () => {
  it('formats and parses namespaced tool names correctly', () => {
    const serverId = 'a83cf928b12e';
    const originalName = 'check_task_completion';

    const providerToolName = MCPProviderSchemaAdapter.formatProviderToolName(serverId, originalName);
    expect(providerToolName).toBe('mcp__a83cf928b12e__check_task_completion');

    const parsed = MCPProviderSchemaAdapter.parseProviderToolName(providerToolName);
    expect(parsed.isMcpTool).toBe(true);
    expect(parsed.serverId).toBe('a83cf928b12e');
    expect(parsed.originalToolName).toBe('check_task_completion');
  });

  it('adapts MCP tool to OpenAI function calling format', () => {
    const mcpTool = {
      name: 'get_monthly_tasks',
      description: 'Get tasks for the month',
      inputSchema: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Month in YYYY-MM' }
        },
        required: ['month']
      }
    };

    const adapted = MCPProviderSchemaAdapter.adaptTool(mcpTool, 'mcp__a83cf928b12e__get_monthly_tasks');
    expect(adapted.type).toBe('function');
    expect(adapted.function.name).toBe('mcp__a83cf928b12e__get_monthly_tasks');
    expect(adapted.function.parameters.properties.month.type).toBe('string');
    expect(adapted.function.parameters.required).toEqual(['month']);
  });
});

describe('MCP Response Normalizer & Taint Tagging', () => {
  it('parses SSE event-stream formatted JSON-RPC responses', () => {
    const sseChunk = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"tower-check","version":"2.0.0"}}}`;
    const parsed = parseMcpResponsePayload(sseChunk);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.result.protocolVersion).toBe('2024-11-05');
    expect(parsed.result.serverInfo.name).toBe('tower-check');
  });

  it('normalizes text and structured results and tags with UNTRUSTED_EXTERNAL_DATA', () => {
    const rawResult = {
      content: [{ type: 'text', text: 'Task 8144521 is 95% complete.' }],
      structuredContent: { taskId: '8144521', completion: 95 }
    };

    const normalized = MCPResponseNormalizer.normalize(rawResult);
    expect(normalized.success).toBe(true);
    expect(normalized.taint).toBe('UNTRUSTED_EXTERNAL_DATA');
    expect(normalized.structuredContent.completion).toBe(95);
    expect(normalized.formattedText).toContain('Task 8144521 is 95% complete.');
  });

  it('rejects oversized structured responses', () => {
    const largeObject = { data: 'x'.repeat(150 * 1024) }; // > 128 KB
    const rawResult = {
      structuredContent: largeObject
    };

    const normalized = MCPResponseNormalizer.normalize(rawResult);
    expect(normalized.success).toBe(false);
    expect(normalized.isError).toBe(true);
    expect(normalized.error).toContain('TOOL_RESULT_TOO_LARGE');
  });
});

describe('MCP Tool Dynamic Subset Selection', () => {
  it('selects top relevant tools based on user prompt', () => {
    const tools = [
      { name: 'tower_check_completion', description: 'Check task completion rate', providerToolName: 'mcp__1__tower_check_completion' },
      { name: 'get_weather', description: 'Query weather info', providerToolName: 'mcp__1__get_weather' },
      { name: 'query_database', description: 'Run database query', providerToolName: 'mcp__1__query_database' },
      { name: 'send_email', description: 'Send email notification', providerToolName: 'mcp__1__send_email' }
    ];

    const selected = MCPToolSelector.selectRelevantTools({
      prompt: '我想查本月任務以及 "8144521" 完成度',
      allEnabledTools: tools,
      maxTools: 2
    });

    expect(selected.length).toBe(2);
    expect(selected[0].name).toBe('tower_check_completion');
  });
});

describe('MCP Tool Risk Policy', () => {
  const toolPolicy = new MCPToolPolicy();

  it('classifies read-only queries vs. destructive operations correctly', () => {
    const readTool = { name: 'tower_check_completion', annotations: { readOnlyHint: true } };
    const deleteTool = { name: 'delete_user_data', annotations: { destructiveHint: true } };
    const emailTool = { name: 'send_email', description: 'Send email to user' };

    expect(toolPolicy.classifyToolRisk(readTool, true)).toBe(ToolRiskLevel.READ_ONLY);
    expect(toolPolicy.classifyToolRisk(deleteTool, true)).toBe(ToolRiskLevel.DESTRUCTIVE);
    expect(toolPolicy.classifyToolRisk(emailTool, true)).toBe(ToolRiskLevel.SENSITIVE);
  });
});

describe('MRTR Multi Round-Trip Interaction Coordinator', () => {
  it('registers interaction and caps max rounds at 6', () => {
    const coordinator = new MCPInteractionCoordinator();

    const record = coordinator.registerInteraction({
      serverId: 'srv1',
      toolName: 'confirm_action',
      inputRequests: [{ name: 'confirm', label: '確認執行？' }],
      requestState: 'opaque_state_bytes_123',
      currentRound: 1
    });

    expect(record.interactionId).toBeDefined();
    expect(record.requestState).toBe('opaque_state_bytes_123');

    expect(() => {
      coordinator.registerInteraction({
        serverId: 'srv1',
        toolName: 'confirm_action',
        currentRound: 7 // Exceeds MAX_MRTR_ROUNDS
      });
    }).toThrow(/MRTR 互動已超過上限輪次/);
  });
});

describe('MCPManager & Native Transport Integration', () => {
  beforeEach(async () => {
    // Clear in-memory MCP servers store
    const servers = await LocalDB.getMcpServers();
    for (const s of servers) {
      await LocalDB.deleteMcpServer(s.id);
    }
  });

  it('saves and deletes Keystore credentials through NativeMCPTransport', async () => {
    const secretRef = 'keystore://mcp_test123/auth_token';
    await NativeMCPTransport.saveCredential(secretRef, 'hf_secret_token_abc');
    expect(await NativeMCPTransport.hasCredential(secretRef)).toBe(true);

    await NativeMCPTransport.deleteCredential(secretRef);
    expect(await NativeMCPTransport.hasCredential(secretRef)).toBe(false);
  });

  it('saves server record without storing raw secret in DB', async () => {
    const server = {
      id: 'mcp_test_srv',
      displayName: 'Test Tower MCP',
      endpoint: 'https://botsz-tower-check-mcp.hf.space/mcp',
      canonicalEndpoint: 'https://botsz-tower-check-mcp.hf.space/mcp',
      protocolVersion: '2026-07-28',
      secretRef: 'keystore://mcp_test_srv/auth_token',
      enabled: true,
      trustLevel: MCPTrustLevel.ALWAYS_TRUSTED,
      tools: [
        {
          name: 'check_completion',
          providerToolName: 'mcp__mcp_test_srv__check_completion',
          description: 'Check task completion',
          llmFunctionDefinition: { type: 'function', function: { name: 'mcp__mcp_test_srv__check_completion' } }
        }
      ]
    };

    await LocalDB.saveMcpServer(server);
    const loaded = await LocalDB.getMcpServer('mcp_test_srv');
    expect(loaded).toBeDefined();
    expect(loaded.displayName).toBe('Test Tower MCP');
    expect(loaded.secretRef).toBe('keystore://mcp_test_srv/auth_token');
    // Ensure no raw token field exists
    expect(loaded.token).toBeUndefined();
    expect(loaded.apiKey).toBeUndefined();
  });
});
