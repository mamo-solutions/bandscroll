export type SessionStatus = "draft" | "live" | "ended";

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
};

/** Slim payload broadcast to clients for the live scroll sync. */
export type SyncState = Pick<
  SessionState,
  "progress" | "speed" | "playing" | "updatedAt" | "status"
>;
