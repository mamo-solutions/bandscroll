import {
  effectiveProgressFromElapsed,
  type SessionState,
  type SyncSnapshot,
} from "../types/session";

export type ViewerConnectionPhase = "syncing" | "connected" | "disconnected";

export const SESSION_SYNC_SNAP_DELTA = 0.04;

export function shouldAcceptSessionState(
  currentVersion: number,
  nextState: SessionState,
  allowEqualVersion = false
): boolean {
  return (
    nextState.stateVersion > currentVersion ||
    (allowEqualVersion && nextState.stateVersion === currentVersion)
  );
}

/**
 * Socket playback snapshots retain the persisted state version between discrete
 * controls. Their strictly increasing position sequence orders ephemeral cursor
 * corrections without making playback ticks persistent state changes.
 */
export function shouldAcceptSyncSnapshot(
  currentVersion: number,
  currentPositionSequence: number | null,
  nextSnapshot: SyncSnapshot,
  allowSequenceReset = false
): boolean {
  if (nextSnapshot.stateVersion > currentVersion) return true;
  if (nextSnapshot.stateVersion < currentVersion) return false;
  if (allowSequenceReset || currentPositionSequence === null) return true;
  return nextSnapshot.positionSequence > currentPositionSequence;
}

export function shouldSnapToSessionState(
  previousState: SessionState | null,
  nextState: SessionState,
  displayedProgress: number
): boolean {
  if (!previousState) return true;
  if (previousState.playbackMode !== nextState.playbackMode) return true;
  if (previousState.playing !== nextState.playing) return true;
  if (previousState.speed !== nextState.speed) return true;
  if (previousState.currentPage !== nextState.currentPage) return true;

  return (
    Math.abs(
      effectiveProgressFromElapsed(nextState, 0) - displayedProgress
    ) > SESSION_SYNC_SNAP_DELTA
  );
}

export function shouldSnapToScrollAnchor(
  previousState: SessionState | null,
  nextState: SessionState,
  anchorChanged: boolean,
  localProgress: number | null,
  displayedProgress: number
): boolean {
  if (!nextState.scrollAnchor) return false;
  if (!previousState) return true;

  return (
    !nextState.playing &&
    (anchorChanged ||
      previousState.playing !== nextState.playing ||
      (localProgress !== null &&
        Math.abs(displayedProgress - localProgress) > SESSION_SYNC_SNAP_DELTA))
  );
}

export function shouldRefreshPlaybackOffset(
  previousState: SessionState | null,
  nextState: SessionState,
  anchorChanged: boolean
): boolean {
  if (!nextState.playing || !nextState.scrollAnchor) return false;
  if (!previousState) return true;

  return (
    !previousState.playing ||
    previousState.playbackMode !== nextState.playbackMode ||
    anchorChanged
  );
}
