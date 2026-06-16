import { randomUUID } from "node:crypto";
import type { SessionState, SessionStatus } from "./types.js";
import { MemorySessionStore } from "./store/memorySessionStore.js";
import type { SessionStoreAdapter } from "./store/sessionStoreAdapter.js";

let adapter: SessionStoreAdapter = new MemorySessionStore();

/** Replace the active storage backend (used once at app startup). */
export function configureSessionStore(newAdapter: SessionStoreAdapter): void {
  adapter = newAdapter;
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

export type CreateSessionInput = {
  title: string;
  description?: string;
  pdfUrl?: string;
};

export function createSession(input: CreateSessionInput): SessionState {
  const now = Date.now();
  const session: SessionState = {
    id: randomUUID(),
    code: generateCode(),
    title: input.title.trim() || "Untitled Session",
    description: input.description?.trim() || undefined,
    pdfUrl: input.pdfUrl ?? "",
    status: "draft",
    playing: false,
    progress: 0,
    speed: 0.001,
    updatedAt: now,
    connectedClients: 0,
    createdAt: now,
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
    "title" | "description" | "pdfUrl" | "status" | "playing" | "progress" | "speed"
  >
>;

export function updateSessionState(
  id: string,
  patch: SessionPatch
): SessionState | undefined {
  const session = adapter.get(id);
  if (!session) return undefined;
  if (patch.progress !== undefined) patch.progress = clampProgress(patch.progress);
  Object.assign(session, patch);
  session.updatedAt = Date.now();
  return adapter.set(session.id, session);
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
  return adapter.set(session.id, session);
}

export function deleteSession(id: string): boolean {
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
