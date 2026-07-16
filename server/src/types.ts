export type SessionStatus = "draft" | "live" | "ended";
export type PlaybackMode = "scroll" | "page";
export type SessionBackgroundMode = "light" | "black";

export type ScrollAnchor = {
  page: number;
  fraction: number;
};

/** Immutable PDF geometry in PDF user-space points.  Coordinates never depend
 * on a browser viewport, rendered canvas size, or scroll container. */
export type DocumentGeometry = {
  revision: string;
  pageHeightsPoints: number[];
  totalHeightPoints: number;
};

/** The one authoritative scroll position. yMicroPoints is measured from the
 * top of the complete PDF and uses integers to avoid accumulated float drift. */
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
  scrollAnchor?: ScrollAnchor;
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
  /** Canonical synchronization state. Legacy progress fields remain only for
   * backwards-compatible persisted sessions and non-scroll UI display. */
  documentGeometry?: DocumentGeometry;
  documentCursor?: DocumentCursor;
  scrollVelocityPointsPerSecond?: number;
  positionUpdatedAt?: number;
  /** Changes only for discrete conductor commands, never playback ticks. */
  controlVersion?: number;
};

/** Ephemeral server-to-client synchronization message. */
export type SyncSnapshot = SessionState & {
  positionSequence: number;
  serverTimestamp: number;
};
