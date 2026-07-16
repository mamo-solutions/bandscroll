import type { DocumentCursor, SessionState } from "../types.js";
import { clampCanonicalScrollVelocity, type SessionPatch } from "../sessionStore.js";
import { advanceDocumentCursor, clampDocumentCursor, cursorAtPageStart, pageForDocumentCursor } from "./documentPosition.js";

export type CanonicalControlIntent = "resume" | "pause" | "seek" | "restart" | "stop" | "seek-marker" | "set-speed";

export type CanonicalControlCommand = {
  intent: CanonicalControlIntent;
  revision: string;
  expectedControlVersion: number;
  cursor?: DocumentCursor;
  markerId?: string;
  velocityPointsPerSecond?: number;
};

export type CanonicalControlResult =
  | { patch: SessionPatch }
  | { error: "control-version-stale" | "document-revision-mismatch" | "document-geometry-unavailable" | "marker-not-found" | "invalid-cursor" };

export function applyCanonicalControl(
  session: SessionState,
  command: CanonicalControlCommand,
  now = Date.now()
): CanonicalControlResult {
  const geometry = session.documentGeometry;
  if (!geometry || !session.documentCursor) return { error: "document-geometry-unavailable" };
  if (geometry.revision !== command.revision) return { error: "document-revision-mismatch" };
  if ((session.controlVersion ?? 0) !== command.expectedControlVersion) return { error: "control-version-stale" };

  const cursor = materializeCursor(session, now);
  if (!cursor) return { error: "document-geometry-unavailable" };
  const controlVersion = (session.controlVersion ?? 0) + 1;
  const base: SessionPatch = { documentCursor: cursor, positionUpdatedAt: now, controlVersion };

  switch (command.intent) {
    case "resume":
      return { patch: { ...base, playing: true, status: "live" } };
    case "pause":
      return { patch: { ...base, playing: false } };
    case "restart":
      return { patch: { ...base, documentCursor: { revision: geometry.revision, yMicroPoints: 0 }, playing: false, currentPage: 1 } };
    case "stop":
      return { patch: { ...base, documentCursor: { revision: geometry.revision, yMicroPoints: 0 }, playing: false, currentPage: 1, status: "draft" } };
    case "seek": {
      const requested = clampDocumentCursor(command.cursor, geometry);
      if (!requested) return { error: "invalid-cursor" };
      return { patch: { ...base, documentCursor: requested, playing: false, currentPage: pageForDocumentCursor(requested, geometry) } };
    }
    case "seek-marker": {
      const marker = session.markers.find((entry) => entry.id === command.markerId);
      if (!marker) return { error: "marker-not-found" };
      const markerCursor = cursorAtPageStart(marker.page, geometry);
      return {
        patch: {
          ...base,
          documentCursor: markerCursor,
          playing: false,
          currentPage: marker.page,
          ...(marker.scrollVelocityPointsPerSecond !== undefined
            ? { scrollVelocityPointsPerSecond: clampCanonicalScrollVelocity(marker.scrollVelocityPointsPerSecond) }
            : {}),
        },
      };
    }
    case "set-speed":
      return {
        patch: {
          ...base,
          scrollVelocityPointsPerSecond: clampCanonicalScrollVelocity(
            Number(command.velocityPointsPerSecond)
          ),
        },
      };
  }
}

function materializeCursor(session: SessionState, now: number): DocumentCursor | undefined {
  if (!session.documentGeometry || !session.documentCursor) return undefined;
  if (!session.playing) return session.documentCursor;
  return advanceDocumentCursor(
    session.documentCursor,
    session.documentGeometry,
    session.scrollVelocityPointsPerSecond ?? 0,
    now - (session.positionUpdatedAt ?? session.updatedAt)
  );
}
