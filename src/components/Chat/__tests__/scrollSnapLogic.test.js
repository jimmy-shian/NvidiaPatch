import { describe, it, expect } from 'vitest';
import {
  SNAP_ANCHOR_OFFSET,
  SNAP_TRIGGER_DISTANCE,
  SNAP_RELEASE_DISTANCE,
  createInitialSnapState,
  startNewScrollGesture,
  completeSnapAnimation,
  evaluateScrollSnap,
  evaluateIdleSnap
} from '../scrollSnapLogic';

const ANCHORS = [
  { id: 'msg-1', offsetTop: 14 },    // targetTop = 0
  { id: 'msg-2', offsetTop: 314 },   // targetTop = 300
  { id: 'msg-3', offsetTop: 614 },   // targetTop = 600
  { id: 'msg-4', offsetTop: 914 }    // targetTop = 900
];

describe('Chat Scroll Snap State Machine', () => {
  it('triggers snap when fast fling crosses an anchor targetTop', () => {
    const initial = createInitialSnapState();
    // Fast upward/downward momentum jump from 210 to 340, crossing targetTop=300
    const { nextState, snapTarget } = evaluateScrollSnap({
      state: initial,
      prevScrollTop: 210,
      currScrollTop: 340,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });

    expect(snapTarget).not.toBeNull();
    expect(snapTarget.id).toBe('msg-2');
    expect(snapTarget.targetTop).toBe(314 - SNAP_ANCHOR_OFFSET);
    expect(nextState.lockedAnchorId).toBe('msg-2');
    expect(nextState.lockedTargetTop).toBe(300);
    expect(nextState.snappedInCurrentGesture).toBe(true);
    expect(nextState.isSnapping).toBe(true);
  });

  it('triggers snap when entering enlarged 48px trigger zone while approaching anchor', () => {
    const initial = createInitialSnapState();
    // Enters within 48px of targetTop=600 (distance 38px < previous 90px)
    const { nextState, snapTarget } = evaluateScrollSnap({
      state: initial,
      prevScrollTop: 510,
      currScrollTop: 562,
      distanceFromBottom: 300,
      anchors: ANCHORS
    });

    expect(SNAP_TRIGGER_DISTANCE).toBe(48);
    expect(snapTarget?.id).toBe('msg-3');
    expect(snapTarget?.targetTop).toBe(600);
    expect(nextState.lockedAnchorId).toBe('msg-3');
  });

  it('does not re-trigger snap in the same gesture or while inside the release zone', () => {
    // 1. Snap to msg-2 (targetTop=300)
    const first = evaluateScrollSnap({
      state: createInitialSnapState(),
      prevScrollTop: 240,
      currScrollTop: 310,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(first.snapTarget?.id).toBe('msg-2');

    // 2. Further scroll events in the same gesture must NOT snap again (even near msg-3)
    const sameGestureWhileAnimating = evaluateScrollSnap({
      state: first.nextState,
      prevScrollTop: 310,
      currScrollTop: 300,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(sameGestureWhileAnimating.snapTarget).toBeNull();

    const settled = completeSnapAnimation(sameGestureWhileAnimating.nextState);
    const sameGestureAfterSettle = evaluateScrollSnap({
      state: settled,
      prevScrollTop: 300,
      currScrollTop: 330,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(sameGestureAfterSettle.snapTarget).toBeNull();

    // 3. Starting a new gesture while still within SNAP_RELEASE_DISTANCE (96px) keeps msg-2 locked
    const newGestureNearAnchor = startNewScrollGesture(settled, 325);
    expect(newGestureNearAnchor.lockedAnchorId).toBe('msg-2');
    expect(newGestureNearAnchor.snappedInCurrentGesture).toBe(false);

    const microOscillationBack = evaluateScrollSnap({
      state: newGestureNearAnchor,
      prevScrollTop: 325,
      currScrollTop: 298,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(microOscillationBack.snapTarget).toBeNull();
  });

  it('unlocks when leaving the 96px release zone and re-snaps only upon returning', () => {
    const snapped = completeSnapAnimation({
      lockedAnchorId: 'msg-2',
      lockedTargetTop: 300,
      snappedInCurrentGesture: true,
      isSnapping: false
    });

    // Move away only 70px (< 96px): still locked
    const insideReleaseZone = evaluateScrollSnap({
      state: startNewScrollGesture(snapped, 300),
      prevScrollTop: 300,
      currScrollTop: 370,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(insideReleaseZone.nextState.lockedAnchorId).toBe('msg-2');

    // Leave release zone: move 105px away (>= 96px)
    const leftReleaseZone = evaluateScrollSnap({
      state: insideReleaseZone.nextState,
      prevScrollTop: 370,
      currScrollTop: 405,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(SNAP_RELEASE_DISTANCE).toBe(96);
    expect(leftReleaseZone.nextState.lockedAnchorId).toBeNull();
    expect(leftReleaseZone.nextState.lockedTargetTop).toBeNull();

    // Return back toward msg-2 (405 -> 320, entering 48px trigger zone from outside) -> re-snaps!
    const returningGesture = startNewScrollGesture(leftReleaseZone.nextState, 405);
    const returned = evaluateScrollSnap({
      state: returningGesture,
      prevScrollTop: 405,
      currScrollTop: 320,
      distanceFromBottom: 400,
      anchors: ANCHORS
    });
    expect(returned.snapTarget).not.toBeNull();
    expect(returned.snapTarget.id).toBe('msg-2');
    expect(returned.nextState.lockedAnchorId).toBe('msg-2');
  });

  it('skips snapping during streaming, active touch drag, or near bottom auto-follow zone', () => {
    const streamingRes = evaluateScrollSnap({
      state: createInitialSnapState(),
      prevScrollTop: 200,
      currScrollTop: 305,
      distanceFromBottom: 300,
      anchors: ANCHORS,
      isStreaming: true
    });
    expect(streamingRes.snapTarget).toBeNull();

    const activeTouchRes = evaluateScrollSnap({
      state: createInitialSnapState(),
      prevScrollTop: 200,
      currScrollTop: 305,
      distanceFromBottom: 300,
      anchors: ANCHORS,
      isTouchActive: true
    });
    expect(activeTouchRes.snapTarget).toBeNull();

    const nearBottomRes = evaluateScrollSnap({
      state: createInitialSnapState(),
      prevScrollTop: 200,
      currScrollTop: 305,
      distanceFromBottom: 20,
      anchors: ANCHORS
    });
    expect(nearBottomRes.snapTarget).toBeNull();
  });

  it('snaps idle resting position within trigger zone after slow drag ends', () => {
    const res = evaluateIdleSnap({
      state: createInitialSnapState(),
      currScrollTop: 330,
      distanceFromBottom: 300,
      anchors: ANCHORS
    });
    expect(res.snapTarget?.id).toBe('msg-2');
    expect(res.snapTarget?.targetTop).toBe(300);
  });
});
