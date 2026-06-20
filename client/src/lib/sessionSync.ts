import { effectiveProgressFromElapsed, type SessionState } from "../types/session";

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
