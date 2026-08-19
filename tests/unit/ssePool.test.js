import { describe, it, expect, vi } from 'vitest';
const eventManager = require('../../gateway/sse/eventManager');

describe('SseConnectionPool', () => {
  it('should register client response and handle close event', () => {
    let closed = false;
    const mockRes = {
      writableEnded: false,
      write: vi.fn(),
      end: vi.fn(),
      on: (event, cb) => {
        if (event === 'close') {
          mockRes._closeCb = cb;
        }
      }
    };

    const id = eventManager.subscribe(mockRes, { ip: '127.0.0.1' });
    expect(id).toBeDefined();
    expect(eventManager.connections.has(id)).toBe(true);

    // Broadcast test
    eventManager.broadcast('custom-event', { foo: 'bar' });
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('event: custom-event'));

    // Heartbeat test
    eventManager.heartbeat();
    expect(mockRes.write).toHaveBeenCalledWith(': heartbeat\n\n');

    // Simulate client disconnect
    mockRes._closeCb();
    expect(eventManager.connections.has(id)).toBe(false);
  });

  it('should gracefully close all connections on closeAll()', () => {
    const mockRes = {
      writableEnded: false,
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn()
    };

    eventManager.subscribe(mockRes, { ip: '127.0.0.1' });
    expect(eventManager.connections.size).toBeGreaterThan(0);

    eventManager.closeAll();
    expect(eventManager.connections.size).toBe(0);
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('event: shutdown'));
    expect(mockRes.end).toHaveBeenCalled();
  });
});
