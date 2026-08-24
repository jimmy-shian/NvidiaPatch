import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDB } from '../storage/localDatabase';

describe('LocalDB Cleanup and Message Integrity', () => {
  const testConvId = 'conv_test_cleanup_123';

  beforeEach(async () => {
    await LocalDB.deleteConversation(testConvId);
  });

  it('cleanupOrphanedToolMessages removes legacy tool rows and empty assistant messages', async () => {
    // Save a mix of valid and orphaned messages
    await LocalDB.saveMessages([
      { id: 'm1', conversationId: testConvId, role: 'user', content: 'What is the job market like?' },
      { id: 'm2', conversationId: testConvId, role: 'assistant', content: '', tool_calls: [{ id: 'tc1' }] }, // empty header
      { id: 'm3', conversationId: testConvId, role: 'tool', content: '{"result": 0}', tool_call_id: 'tc1' }, // raw protocol tool
      {
        id: 'm4',
        conversationId: testConvId,
        role: 'assistant',
        content: 'Here is the job market overview.',
        toolExecutions: [{ toolName: 'web_search', status: 'completed', result: { resultCount: 0 } }]
      }
    ]);

    let msgs = await LocalDB.getMessages(testConvId);
    expect(msgs).toHaveLength(4);

    // Run cleanup
    await LocalDB.cleanupOrphanedToolMessages(testConvId);

    msgs = await LocalDB.getMessages(testConvId);
    expect(msgs).toHaveLength(2);
    expect(msgs.map(m => m.id)).toEqual(['m1', 'm4']);
  });

  it('preserves valid assistant messages with thinking content or tool executions', async () => {
    await LocalDB.saveMessages([
      { id: 'm1', conversationId: testConvId, role: 'user', content: 'Hello' },
      {
        id: 'm2',
        conversationId: testConvId,
        role: 'assistant',
        content: 'Hi there!',
        thinkingContent: 'Thinking about greetings...'
      }
    ]);

    await LocalDB.cleanupOrphanedToolMessages(testConvId);

    const msgs = await LocalDB.getMessages(testConvId);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe('Hi there!');
  });
});
