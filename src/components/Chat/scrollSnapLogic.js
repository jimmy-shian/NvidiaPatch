/**
 * Chat Scroll Snap State Machine
 *
 * Core rule:
 *   Snap once at an anchor -> leave the release zone -> re-enable only when returning.
 *
 * Zones around a snap target (`targetTop = max(0, offsetTop - SNAP_ANCHOR_OFFSET)`):
 *   - Trigger zone: |scrollTop - targetTop| <= SNAP_TRIGGER_DISTANCE (48px) or crossed during fast fling.
 *   - Release (re-enable) zone: |scrollTop - lockedTargetTop| >= SNAP_RELEASE_DISTANCE (96px).
 *     The hysteresis gap (96px vs 48px) prevents jitter/repeated snapping near boundaries.
 */

export const SNAP_ANCHOR_OFFSET = 14;
export const SNAP_TRIGGER_DISTANCE = 48;
export const SNAP_RELEASE_DISTANCE = 96;
export const SNAP_BOTTOM_BYPASS_DISTANCE = 35;

export function createInitialSnapState() {
  return {
    lockedAnchorId: null,
    lockedTargetTop: null,
    snappedInCurrentGesture: false,
    isSnapping: false
  };
}

/**
 * Called when a new touch or wheel gesture begins.
 * Clears `snappedInCurrentGesture` so the new gesture may snap to another anchor,
 * while preserving `lockedAnchorId` until the user leaves the release zone.
 */
export function startNewScrollGesture(state, currScrollTop = 0) {
  const base = state || createInitialSnapState();
  const hasLeftLockedZone =
    base.lockedAnchorId !== null &&
    base.lockedTargetTop !== null &&
    Math.abs(currScrollTop - base.lockedTargetTop) >= SNAP_RELEASE_DISTANCE;

  return {
    lockedAnchorId: hasLeftLockedZone ? null : base.lockedAnchorId,
    lockedTargetTop: hasLeftLockedZone ? null : base.lockedTargetTop,
    snappedInCurrentGesture: false,
    isSnapping: false
  };
}

/**
 * Called after smooth snap scroll animation finishes.
 * Clears `isSnapping` while keeping lock & current-gesture guard intact.
 */
export function completeSnapAnimation(state) {
  const base = state || createInitialSnapState();
  return {
    ...base,
    isSnapping: false
  };
}

function resolveAnchorTargetTop(anchor) {
  if (typeof anchor?.targetTop === 'number') {
    return Math.max(0, anchor.targetTop);
  }
  return Math.max(0, (anchor?.offsetTop || 0) - SNAP_ANCHOR_OFFSET);
}

/**
 * Evaluates scroll progress and determines whether to unlock a previous snap
 * or trigger a snap to a message anchor.
 */
export function evaluateScrollSnap({
  state,
  prevScrollTop,
  currScrollTop,
  distanceFromBottom = Infinity,
  anchors = [],
  isStreaming = false,
  isProgrammatic = false,
  isTouchActive = false
}) {
  let nextState = { ...(state || createInitialSnapState()) };

  // 1. Re-enable check: unlock once the viewport has moved out of the release zone
  if (!nextState.isSnapping && nextState.lockedAnchorId !== null && nextState.lockedTargetTop !== null) {
    if (Math.abs(currScrollTop - nextState.lockedTargetTop) >= SNAP_RELEASE_DISTANCE) {
      nextState.lockedAnchorId = null;
      nextState.lockedTargetTop = null;
      nextState.snappedInCurrentGesture = false;
    }
  }

  // 2. Guards: do not snap while streaming, programmatic jumps, active finger drag,
  //    active snap animation, near bottom auto-follow zone, or already snapped in this gesture
  if (
    isStreaming ||
    isProgrammatic ||
    isTouchActive ||
    nextState.isSnapping ||
    nextState.snappedInCurrentGesture ||
    distanceFromBottom <= SNAP_BOTTOM_BYPASS_DISTANCE
  ) {
    return { nextState, snapTarget: null };
  }

  const delta = currScrollTop - prevScrollTop;
  if (Math.abs(delta) < 0.5 || !Array.isArray(anchors) || anchors.length === 0) {
    return { nextState, snapTarget: null };
  }

  // 3. Match unlocked anchors crossed by fast scroll or entered within trigger radius
  let bestMatch = null;
  let bestDist = Infinity;

  for (const anchor of anchors) {
    if (!anchor || anchor.id == null) continue;
    if (anchor.id === nextState.lockedAnchorId) continue;

    const targetTop = resolveAnchorTargetTop(anchor);
    const crossed =
      (prevScrollTop < targetTop && currScrollTop >= targetTop) ||
      (prevScrollTop > targetTop && currScrollTop <= targetTop);

    const currDist = Math.abs(currScrollTop - targetTop);
    const prevDist = Math.abs(prevScrollTop - targetTop);
    const enteredTriggerZone = currDist <= SNAP_TRIGGER_DISTANCE && currDist < prevDist;

    if ((crossed || enteredTriggerZone) && currDist < bestDist) {
      bestDist = currDist;
      bestMatch = {
        ...anchor,
        targetTop
      };
    }
  }

  if (!bestMatch) {
    return { nextState, snapTarget: null };
  }

  nextState = {
    lockedAnchorId: bestMatch.id,
    lockedTargetTop: bestMatch.targetTop,
    snappedInCurrentGesture: true,
    isSnapping: true
  };

  return { nextState, snapTarget: bestMatch };
}

/**
 * Evaluates whether a resting scroll position (after slow drag ends with no inertia)
 * sits within SNAP_TRIGGER_DISTANCE of an unlocked anchor.
 */
export function evaluateIdleSnap({
  state,
  currScrollTop,
  distanceFromBottom = Infinity,
  anchors = [],
  isStreaming = false,
  isProgrammatic = false
}) {
  let nextState = { ...(state || createInitialSnapState()) };

  if (!nextState.isSnapping && nextState.lockedAnchorId !== null && nextState.lockedTargetTop !== null) {
    if (Math.abs(currScrollTop - nextState.lockedTargetTop) >= SNAP_RELEASE_DISTANCE) {
      nextState.lockedAnchorId = null;
      nextState.lockedTargetTop = null;
      nextState.snappedInCurrentGesture = false;
    }
  }

  if (
    isStreaming ||
    isProgrammatic ||
    nextState.isSnapping ||
    nextState.snappedInCurrentGesture ||
    distanceFromBottom <= SNAP_BOTTOM_BYPASS_DISTANCE ||
    !Array.isArray(anchors) ||
    anchors.length === 0
  ) {
    return { nextState, snapTarget: null };
  }

  let bestMatch = null;
  let bestDist = SNAP_TRIGGER_DISTANCE + 1;

  for (const anchor of anchors) {
    if (!anchor || anchor.id == null) continue;
    if (anchor.id === nextState.lockedAnchorId) continue;

    const targetTop = resolveAnchorTargetTop(anchor);
    const currDist = Math.abs(currScrollTop - targetTop);
    if (currDist >= 1 && currDist <= SNAP_TRIGGER_DISTANCE && currDist < bestDist) {
      bestDist = currDist;
      bestMatch = {
        ...anchor,
        targetTop
      };
    }
  }

  if (!bestMatch) {
    return { nextState, snapTarget: null };
  }

  nextState = {
    lockedAnchorId: bestMatch.id,
    lockedTargetTop: bestMatch.targetTop,
    snappedInCurrentGesture: true,
    isSnapping: true
  };

  return { nextState, snapTarget: bestMatch };
}
