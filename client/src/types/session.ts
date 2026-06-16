export type SessionStatus = "draft" | "live" | "ended";

export type SongMarker = {
  id: string;
  title: string;
  page: number; // 1-indexed page number in the PDF
};

export type SessionState = {
  id: string;
  code: string;
  title: string;
  description?: string;
  pdfUrl: string;
  status: SessionStatus;
  playing: boolean;
  progress: number; // 0.0 .. 1.0
  speed: number; // progress per second
  updatedAt: number; // server timestamp in ms
  connectedClients: number;
  createdAt: number;
  markers: SongMarker[];
};

/** Compute live progress from the last server snapshot. */
export function effectiveProgress(state: SessionState, now = Date.now()): number {
  if (!state.playing) return clamp01(state.progress);
  const elapsed = (now - state.updatedAt) / 1000;
  return clamp01(state.progress + elapsed * state.speed);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
