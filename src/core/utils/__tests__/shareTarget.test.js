import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkPendingSharedText } from '../shareTarget';

describe('Share Target Helper', () => {
  beforeEach(() => {
    globalThis.window = globalThis;
    delete globalThis.NativeStreamBridge;
  });

  it('returns null when NativeStreamBridge is not available', () => {
    expect(checkPendingSharedText()).toBeNull();
  });

  it('reads and trims pending shared text from NativeStreamBridge', () => {
    window.NativeStreamBridge = {
      getPendingSharedText: vi.fn().mockReturnValue('  今日運勢如何？  ')
    };

    const text = checkPendingSharedText();
    expect(text).toBe('今日運勢如何？');
    expect(window.NativeStreamBridge.getPendingSharedText).toHaveBeenCalledTimes(1);
  });

  it('returns null when pending shared text is empty string', () => {
    window.NativeStreamBridge = {
      getPendingSharedText: vi.fn().mockReturnValue('   ')
    };

    expect(checkPendingSharedText()).toBeNull();
  });
});
