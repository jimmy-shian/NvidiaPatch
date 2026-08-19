import { describe, it, expect, vi, beforeEach } from 'vitest';
const { logger, addLog, activeLogs, setLogLevel } = require('../../gateway/logs/logger');

describe('Structured Logger', () => {
  beforeEach(() => {
    activeLogs.length = 0;
  });

  it('should push log entries into activeLogs buffer with timestamp and type', () => {
    logger.info('Gateway server starting', { requestId: 'req-001' });
    expect(activeLogs.length).toBe(1);
    const entry = activeLogs[0];
    expect(entry.type).toBe('info');
    expect(entry.message).toBe('Gateway server starting');
    expect(entry.requestId).toBe('req-001');
    expect(entry.timestamp).toBeDefined();
  });

  it('should support addLog for backward compatibility', () => {
    addLog('warning', 'Model failed, initiating fallback', { requestId: 'req-002' });
    expect(activeLogs.length).toBe(1);
    const entry = activeLogs[0];
    expect(entry.type).toBe('warning');
    expect(entry.message).toBe('Model failed, initiating fallback');
    expect(entry.requestId).toBe('req-002');
  });

  it('should cap activeLogs to 100 entries', () => {
    for (let i = 0; i < 120; i++) {
      logger.info(`Message ${i}`);
    }
    expect(activeLogs.length).toBe(100);
    expect(activeLogs[activeLogs.length - 1].message).toBe('Message 119');
  });
});
