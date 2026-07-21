export type SessionStatus = "draft" | "live" | "ended";
export type PlaybackMode = "scroll" | "page";
export type SessionBackgroundMode = "light" | "black";

export type ScrollAnchor = {
  page: number;
  fraction: number;
};

export type DocumentGeometry = {
  revision: string;
  pageHeightsPoints: number[];
  totalHeightPoints: number;
};

export type DocumentCursor = {
  revision: string;
  yMicroPoints: number;
};

export type SongMarker = {
  id: string;
  title: string;
  page: number; // 1-indexed page number in the PDF
  speed?: number; // Legacy scroll speed (progress/second), retained for migrated sessions.
  scrollVelocityPointsPerSecond?: number; // Canonical PDF-point speed restored for this marker.
};

export type SessionState = {
  id: string;
  code: string;
  title: string;
  description?: string;
  documentDescription?: string;
  pdfUrl: string;
  status: SessionStatus;
  playing: boolean;
  progress: number; // 0.0 .. 1.0
  scrollAnchor?: ScrollAnchor; // viewport-independent top-of-viewport document position
  speed: number; // progress per second
  updatedAt: number; // server timestamp in ms
  connectedClients: number;
  createdAt: number;
  markers: SongMarker[];
  locked: boolean;
  playbackMode: PlaybackMode;
  backgroundMode: SessionBackgroundMode;
  autoStopAtSongEnd: boolean;
  currentPage: number;
  numPages: number;
  stateVersion: number;
  documentGeometry?: DocumentGeometry;
  documentCursor?: DocumentCursor;
  autoStopCursor?: DocumentCursor | null;
  scrollVelocityPointsPerSecond?: number;
  positionUpdatedAt?: number;
  controlVersion?: number;
};

/** Ephemeral server-to-client synchronization message. */
export type SyncSnapshot = SessionState & {
  positionSequence: number;
  serverTimestamp: number;
};

export const MICRO_POINTS_PER_POINT = 1_000;

export function effectiveDocumentCursor(
  state: SessionState,
  elapsedMs: number
): DocumentCursor | undefined {
  if (!state.documentCursor || !state.documentGeometry) return undefined;
  const velocity = state.playing ? state.scrollVelocityPointsPerSecond ?? 0 : 0;
  const maximum = Math.round(state.documentGeometry.totalHeightPoints * MICRO_POINTS_PER_POINT);
  return {
    revision: state.documentCursor.revision,
    yMicroPoints: Math.min(
      maximum,
      Math.max(0, state.documentCursor.yMicroPoints + Math.round((velocity * elapsedMs * MICRO_POINTS_PER_POINT) / 1000))
    ),
  };
}

/** Compute live progress from the last server snapshot.
 *  NOTE: This compares client `now` against server `updatedAt`, so clock skew
 *  between client and server can make progress run backwards. For production
 *  rendering prefer `effectiveProgressFromElapsed()` with a locally-recorded
 *  receive timestamp. */
export function effectiveProgress(state: SessionState, now = Date.now()): number {
  if (!state.playing) return clamp01(state.progress);
  const elapsed = (now - state.updatedAt) / 1000;
  return clamp01(state.progress + elapsed * state.speed);
}

/** Compute live progress from locally-measured elapsed milliseconds.
 *  Use this in viewers to avoid backwards scrolling when the device clock is
 *  behind the server's clock. */
export function effectiveProgressFromElapsed(state: SessionState, elapsedMs: number): number {
  if (!state.playing) return clamp01(state.progress);
  return clamp01(state.progress + (elapsedMs / 1000) * state.speed);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
