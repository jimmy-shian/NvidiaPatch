import { describe, it, expect } from 'vitest';
import { sanitizeMessagesForApi } from '../messageSanitizer';

describe('Message Sanitizer for OpenAI & NVIDIA NIM Compliance', () => {
  it('strips unauthorized fields such as name and metadata from role: tool messages', () => {
    const rawMessages = [
      {
        id: 'msg_1',
        conversationId: 'conv_1',
        role: 'system',
        content: 'You are an AI.'
      },
      {
        id: 'msg_2',
        role: 'user',
        content: 'Search news'
      },
      {
        id: 'msg_3',
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: { name: 'web_search', arguments: '{"query":"nvidia"}' }
          }
        ]
      },
      {
        id: 'msg_4',
        role: 'tool',
        tool_call_id: 'call_123',
        name: 'web_search', // Should be strictly stripped!
        toolExecutions: [{ status: 'completed' }], // Should be stripped!
        content: '{"results":[{"title":"News"}]}'
      }
    ];

    const sanitized = sanitizeMessagesForApi(rawMessages);

    expect(sanitized).toHaveLength(4);

    // Verify system message
    expect(sanitized[0]).toEqual({
      role: 'system',
      content: 'You are an AI.'
    });

    // Verify assistant message
    expect(sanitized[2].role).toBe('assistant');
    expect(sanitized[2].content).toBeNull();
    expect(sanitized[2].tool_calls).toHaveLength(1);
    expect(sanitized[2].id).toBeUndefined();

    // Verify tool message
    const toolMsg = sanitized[3];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call_123');
    expect(toolMsg.content).toBe('{"results":[{"title":"News"}]}');
    expect(toolMsg.name).toBeUndefined(); // Crucial!
    expect(toolMsg.id).toBeUndefined();
    expect(toolMsg.toolExecutions).toBeUndefined();
  });

  it('handles multimodal image parts in user messages correctly', () => {
    const raw = [
      {
        role: 'user',
        content: 'What is this?',
        images: ['data:image/png;base64,abc123']
      }
    ];

    const sanitized = sanitizeMessagesForApi(raw);
    expect(sanitized[0].role).toBe('user');
    expect(Array.isArray(sanitized[0].content)).toBe(true);
    expect(sanitized[0].content[0]).toEqual({ type: 'text', text: 'What is this?' });
    expect(sanitized[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } });
  });

  it('ensures assistant message with tool_calls has content: null according to NVIDIA NIM spec', () => {
    const raw = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{}' } }]
      }
    ];

    const sanitized = sanitizeMessagesForApi(raw);
    expect(sanitized[0].content).toBeNull();
  });
});
