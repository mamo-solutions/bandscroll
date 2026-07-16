import type { DocumentCursor, SessionState } from "../types.js";
import { advanceDocumentCursor, pageForDocumentCursor } from "./documentPosition.js";

/**
 * The wire representation of a session-state broadcast. The persisted session
 * remains the baseline for canonical playback; each snapshot materializes that
 * baseline at one server timestamp without writing it back to storage.
 */
export type SyncSnapshot = SessionState & {
  positionSequence: number;
  serverTimestamp: number;
};

export function materializeDocumentCursor(session: SessionState, now: number): DocumentCursor | undefined {
  if (!session.documentGeometry || !session.documentCursor) return undefined;
  if (!session.playing) return session.documentCursor;

  return advanceDocumentCursor(
    session.documentCursor,
    session.documentGeometry,
    session.scrollVelocityPointsPerSecond ?? 0,
    now - (session.positionUpdatedAt ?? session.updatedAt)
  );
}

export function createSyncSnapshot(
  session: SessionState,
  positionSequence: number,
  now = Date.now()
): SyncSnapshot {
  const cursor = materializeDocumentCursor(session, now);
  if (!cursor || !session.documentGeometry) {
    return { ...session, positionSequence, serverTimestamp: now };
  }

  return {
    ...session,
    documentCursor: cursor,
    currentPage: pageForDocumentCursor(cursor, session.documentGeometry),
    positionUpdatedAt: now,
    positionSequence,
    serverTimestamp: now,
  };
}
