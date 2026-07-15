export type SessionStatus = "draft" | "live" | "ended";
export type PlaybackMode = "scroll" | "page";
export type SessionBackgroundMode = "light" | "black";

export type ScrollAnchor = {
  page: number;
  fraction: number;
};

export type SongMarker = {
  id: string;
  title: string;
  page: number; // 1-indexed page number in the PDF
  speed?: number; // scroll speed (progress/second) to restore when this marker is loaded
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
};

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
