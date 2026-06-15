import { randomUUID } from "node:crypto";
import type { SessionState, SessionStatus } from "./types.js";

const sessions = new Map<string, SessionState>();

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
  sessions.set(session.id, session);
  return session;
}

export function getSessionById(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function getSessionByCode(code: string): SessionState | undefined {
  const normalized = code.trim().toUpperCase();
  for (const session of sessions.values()) {
    if (session.code === normalized) return session;
  }
  return undefined;
}

/** Public list: all open (non-ended) sessions, newest first. */
export function listPublicSessions(): SessionState[] {
  return [...sessions.values()]
    .filter((s) => s.status !== "ended")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listAdminSessions(): SessionState[] {
  return [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
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
  const session = sessions.get(id);
  if (!session) return undefined;
  if (patch.progress !== undefined) patch.progress = clampProgress(patch.progress);
  Object.assign(session, patch);
  session.updatedAt = Date.now();
  return session;
}

export function setStatus(id: string, status: SessionStatus): SessionState | undefined {
  return updateSessionState(id, { status });
}

export function endSession(id: string): SessionState | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.status = "ended";
  session.playing = false;
  session.updatedAt = Date.now();
  return session;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function incrementClientCount(id: string): number {
  const session = sessions.get(id);
  if (!session) return 0;
  session.connectedClients += 1;
  return session.connectedClients;
}

export function decrementClientCount(id: string): number {
  const session = sessions.get(id);
  if (!session) return 0;
  session.connectedClients = Math.max(0, session.connectedClients - 1);
  return session.connectedClients;
}
