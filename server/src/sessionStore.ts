import { randomUUID } from "node:crypto";
import type { DocumentCursor, DocumentGeometry, SessionState, SessionStatus } from "./types.js";
import { clampDocumentCursor } from "./lib/documentPosition.js";
import { MemorySessionStore } from "./store/memorySessionStore.js";
import type { SessionStoreAdapter } from "./store/sessionStoreAdapter.js";

let adapter: SessionStoreAdapter = new MemorySessionStore();

export const CANONICAL_SCROLL_VELOCITY_MIN = 3;
export const CANONICAL_SCROLL_VELOCITY_MAX = 120;
export const CANONICAL_SCROLL_VELOCITY_DEFAULT = 36;

export function clampCanonicalScrollVelocity(value: number): number {
  if (!Number.isFinite(value)) return CANONICAL_SCROLL_VELOCITY_DEFAULT;
  return Math.min(
    CANONICAL_SCROLL_VELOCITY_MAX,
    Math.max(CANONICAL_SCROLL_VELOCITY_MIN, Math.round(value))
  );
}

/** Replace the active storage backend (used once at app startup). */
export function configureSessionStore(newAdapter: SessionStoreAdapter): void {
  adapter = newAdapter;
}

export function clearSessionStore(): void {
  adapter.clear();
}

function generateCode(): string {
  // e.g. SESSION-7421 — re-roll on the (very unlikely) collision.
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = `SESSION-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!getSessionByCode(code)) return code;
  }
  return `SESSION-${randomUUID().slice(0, 4).toUpperCase()}`;
}

export function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clampCurrentPage(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

export type CreateSessionInput = {
  title: string;
  description?: string;
  documentDescription?: string;
  pdfUrl?: string;
};

export function createSession(input: CreateSessionInput): SessionState {
  const now = Date.now();
  const session: SessionState = {
    id: randomUUID(),
    code: generateCode(),
    title: input.title.trim() || "Untitled Session",
    description: input.description?.trim() || undefined,
    documentDescription: input.documentDescription?.trim() || undefined,
    pdfUrl: input.pdfUrl ?? "",
    status: "draft",
    playing: false,
    progress: 0,
    speed: 0.0002, // default to client speed preset 3
    updatedAt: now,
    connectedClients: 0,
    createdAt: now,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 0,
    stateVersion: 0,
    documentGeometry: undefined,
    documentCursor: undefined,
    scrollVelocityPointsPerSecond: undefined,
    positionUpdatedAt: now,
    controlVersion: 0,
  };
  adapter.set(session.id, session);
  return session;
}

export function getSessionById(id: string): SessionState | undefined {
  return adapter.get(id);
}

export function getSessionByCode(code: string): SessionState | undefined {
  const normalized = code.trim().toUpperCase();
  for (const session of adapter.values()) {
    if (session.code === normalized) return session;
  }
  return undefined;
}

/** Public list: all open (non-ended) sessions, newest first. */
export function listPublicSessions(): SessionState[] {
  return [...adapter.values()]
    .filter((s) => s.status !== "ended")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listAdminSessions(): SessionState[] {
  return [...adapter.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export type SessionPatch = Partial<
  Pick<
    SessionState,
    | "title"
    | "description"
    | "documentDescription"
    | "pdfUrl"
    | "status"
    | "playing"
    | "progress"
    | "scrollAnchor"
    | "speed"
    | "markers"
    | "locked"
    | "playbackMode"
    | "backgroundMode"
    | "autoStopAtSongEnd"
    | "currentPage"
    | "numPages"
    | "documentGeometry"
    | "documentCursor"
    | "scrollVelocityPointsPerSecond"
    | "positionUpdatedAt"
    | "controlVersion"
  >
>;

export function updateSessionState(
  id: string,
  patch: SessionPatch
): SessionState | undefined {
  const session = adapter.get(id);
  if (!session) return undefined;
  const hasChanges = Object.keys(patch).length > 0;
  if (patch.progress !== undefined) patch.progress = clampProgress(patch.progress);
  if (patch.scrollAnchor !== undefined) {
    patch.scrollAnchor = {
      page: clampCurrentPage(patch.scrollAnchor.page),
      fraction: clampProgress(patch.scrollAnchor.fraction),
    };
  }
  if (patch.currentPage !== undefined) patch.currentPage = clampCurrentPage(patch.currentPage);
  if (patch.numPages !== undefined) patch.numPages = Math.max(0, Math.round(patch.numPages) || 0);
  if (patch.documentGeometry !== undefined) {
    patch.documentGeometry = normalizeDocumentGeometry(patch.documentGeometry);
  }
  const geometry = patch.documentGeometry ?? session.documentGeometry;
  if (patch.documentCursor !== undefined) {
    patch.documentCursor = clampDocumentCursor(patch.documentCursor, geometry);
  }
  if (patch.scrollVelocityPointsPerSecond !== undefined) {
    patch.scrollVelocityPointsPerSecond = clampCanonicalScrollVelocity(
      Number(patch.scrollVelocityPointsPerSecond)
    );
  }
  if (patch.controlVersion !== undefined) {
    patch.controlVersion = Math.max(0, Math.round(patch.controlVersion) || 0);
  }
  Object.assign(session, patch);
  session.updatedAt = Date.now();
  if (hasChanges) session.stateVersion += 1;
  return adapter.set(session.id, session);
}

function normalizeDocumentGeometry(geometry: DocumentGeometry): DocumentGeometry {
  const pageHeightsPoints = Array.isArray(geometry.pageHeightsPoints)
    ? geometry.pageHeightsPoints.map((height) => Math.max(0, Number(height) || 0))
    : [];
  return {
    revision: String(geometry.revision ?? ""),
    pageHeightsPoints,
    totalHeightPoints: pageHeightsPoints.reduce((total, height) => total + height, 0),
  };
}

export function setStatus(id: string, status: SessionStatus): SessionState | undefined {
  return updateSessionState(id, { status });
}

export function endSession(id: string): SessionState | undefined {
  const session = adapter.get(id);
  if (!session) return undefined;
  session.status = "ended";
  session.playing = false;
  session.updatedAt = Date.now();
  session.stateVersion += 1;
  return adapter.set(session.id, session);
}

export function toggleSessionLock(id: string): SessionState | undefined {
  const session = adapter.get(id);
  if (!session) return undefined;
  return updateSessionState(id, { locked: !session.locked });
}

export function deleteSession(id: string): boolean {
  const session = adapter.get(id);
  if (session?.locked) return false;
  return adapter.delete(id);
}

export function incrementClientCount(id: string): number {
  const session = adapter.get(id);
  if (!session) return 0;
  session.connectedClients += 1;
  return session.connectedClients;
}

export function decrementClientCount(id: string): number {
  const session = adapter.get(id);
  if (!session) return 0;
  session.connectedClients = Math.max(0, session.connectedClients - 1);
  return session.connectedClients;
}
