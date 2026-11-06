import { describe, it, expect } from 'vitest';
import {
  CONTEXT_COLLAPSE_DISTANCE,
  CONTEXT_EXPAND_DISTANCE,
  nextContextBarCollapsed
} from '../contextBarLogic';

const base = {
  collapsed: false,
  scrollTop: 1000,
  prevScrollTop: 1010,
  distanceFromBottom: 400,
  isProgrammatic: false
};

describe('nextContextBarCollapsed', () => {
  it('collapses only on a real upward scroll far from the bottom', () => {
    expect(nextContextBarCollapsed(base)).toBe(true);
    expect(
      nextContextBarCollapsed({ ...base, distanceFromBottom: CONTEXT_COLLAPSE_DISTANCE })
    ).toBe(false);
    expect(
      nextContextBarCollapsed({ ...base, distanceFromBottom: CONTEXT_COLLAPSE_DISTANCE + 1 })
    ).toBe(true);
  });

  it('ignores sub-pixel jitter and downward scrolls', () => {
    expect(nextContextBarCollapsed({ ...base, scrollTop: 1000, prevScrollTop: 1000.5 })).toBe(false);
    expect(nextContextBarCollapsed({ ...base, scrollTop: 1010, prevScrollTop: 1000 })).toBe(false);
  });

  it('keeps the bar expanded inside the hysteresis band while browsing', () => {
    expect(
      nextContextBarCollapsed({ ...base, distanceFromBottom: CONTEXT_EXPAND_DISTANCE + 1 })
    ).toBe(false);
  });

  it('expands again near the latest message', () => {
    const collapsed = { ...base, collapsed: true };
    expect(
      nextContextBarCollapsed({
        ...collapsed,
        scrollTop: 900,
        prevScrollTop: 910,
        distanceFromBottom: CONTEXT_EXPAND_DISTANCE
      })
    ).toBe(false);
    expect(
      nextContextBarCollapsed({
        ...collapsed,
        scrollTop: 900,
        prevScrollTop: 910,
        distanceFromBottom: CONTEXT_EXPAND_DISTANCE + 1
      })
    ).toBe(true);
  });

  it('never toggles during programmatic scrolls (marker jump / scroll-to-bottom)', () => {
    expect(nextContextBarCollapsed({ ...base, isProgrammatic: true })).toBe(false);
    expect(
      nextContextBarCollapsed({
        ...base,
        collapsed: true,
        distanceFromBottom: 0,
        isProgrammatic: true
      })
    ).toBe(true);
  });
});
