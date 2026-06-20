export type SessionStatus = "draft" | "live" | "ended";
export type PlaybackMode = "scroll" | "page";

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
  locked: boolean;
  playbackMode: PlaybackMode;
  currentPage: number;
  numPages: number;
  stateVersion: number;
};
