import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { RequestHandler } from "express";
import {
  decrementClientCount,
  getSessionByCode,
  getSessionById,
  incrementClientCount,
  updateSessionState,
  clampProgress,
} from "../sessionStore.js";
import type { SessionState } from "../types.js";

let io: Server | null = null;

function roomFor(code: string): string {
  return `session:${code}`;
}

/** True if this socket's shared express-session is an authenticated admin. */
function isAdminSocket(socket: Socket): boolean {
  // express-session is attached to the underlying request via engine middleware.
  const req = socket.request as unknown as { session?: { isAdmin?: boolean } };
  return req.session?.isAdmin === true;
}

export function initSocketServer(
  httpServer: HttpServer,
  sessionMiddleware: RequestHandler
): Server {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  // Share the express-session middleware so socket.request.session is populated.
  io.engine.use(sessionMiddleware);

  io.on("connection", (socket) => {
    // Track which session room this socket counts towards so we can decrement
    // exactly once on leave/disconnect.
    let joinedSessionId: string | null = null;
    let counted = false;

    const emitClientCount = (session: SessionState) => {
      io?.to(roomFor(session.code)).emit("client-count", {
        sessionId: session.id,
        connectedClients: session.connectedClients,
      });
    };

    const leaveCurrent = () => {
      if (!joinedSessionId) return;
      const session = getSessionById(joinedSessionId);
      if (session) {
        socket.leave(roomFor(session.code));
        if (counted) {
          decrementClientCount(session.id);
          emitClientCount(session);
          broadcastSessionState(session);
        }
      }
      joinedSessionId = null;
      counted = false;
    };

    // ---- Public client events ----
    socket.on("join-session", (code: string) => {
      const session = getSessionByCode(String(code ?? ""));
      if (!session) {
        socket.emit("session-not-found", { code });
        return;
      }
      leaveCurrent();
      socket.join(roomFor(session.code));
      joinedSessionId = session.id;
      counted = true;
      incrementClientCount(session.id);
      socket.emit("session-state", session);
      emitClientCount(session);
      broadcastSessionState(session);
    });

    socket.on("leave-session", () => leaveCurrent());

    socket.on("request-session-state", (codeOrId?: string) => {
      const session =
        (joinedSessionId ? getSessionById(joinedSessionId) : undefined) ??
        getSessionByCode(String(codeOrId ?? "")) ??
        getSessionById(String(codeOrId ?? ""));
      if (session) socket.emit("session-state", session);
      else socket.emit("session-not-found", { code: codeOrId });
    });

    // ---- Admin events (server-side authenticated) ----
    const guardAdmin = (): boolean => {
      if (isAdminSocket(socket)) return true;
      socket.emit("admin-error", { error: "unauthorized" });
      return false;
    };

    const adminUpdate = (
      sessionId: string,
      patch: Parameters<typeof updateSessionState>[1]
    ) => {
      const session = updateSessionState(sessionId, patch);
      if (session) broadcastSessionState(session);
      return session;
    };

    socket.on("admin-join-session", (sessionId: string) => {
      if (!guardAdmin()) return;
      const session = getSessionById(String(sessionId ?? ""));
      if (!session) {
        socket.emit("session-not-found", { id: sessionId });
        return;
      }
      socket.join(roomFor(session.code));
      socket.emit("session-state", session);
    });

    socket.on("admin-play", (sessionId: string) => {
      if (!guardAdmin()) return;
      adminUpdate(String(sessionId), { playing: true, status: "live" });
    });

    socket.on("admin-pause", (sessionId: string) => {
      if (!guardAdmin()) return;
      adminUpdate(String(sessionId), { playing: false });
    });

    socket.on("admin-stop", (sessionId: string) => {
      if (!guardAdmin()) return;
      adminUpdate(String(sessionId), { playing: false, progress: 0 });
    });

    socket.on(
      "admin-seek",
      (payload: { sessionId: string; progress: number }) => {
        if (!guardAdmin()) return;
        adminUpdate(String(payload?.sessionId), {
          progress: clampProgress(Number(payload?.progress)),
        });
      }
    );

    socket.on(
      "admin-set-speed",
      (payload: { sessionId: string; speed: number }) => {
        if (!guardAdmin()) return;
        const speed = Math.max(0, Number(payload?.speed) || 0);
        adminUpdate(String(payload?.sessionId), { speed });
      }
    );

    socket.on(
      "admin-set-markers",
      (payload: { sessionId: string; markers: SessionState["markers"] }) => {
        if (!guardAdmin()) return;
        const markers = Array.isArray(payload?.markers) ? payload.markers : [];
        adminUpdate(String(payload?.sessionId), { markers });
      }
    );

    // Lightweight periodic sync sent ~every 250ms while playing.
    socket.on(
      "admin-sync",
      (payload: { sessionId: string; progress: number; playing?: boolean }) => {
        if (!guardAdmin()) return;
        adminUpdate(String(payload?.sessionId), {
          progress: clampProgress(Number(payload?.progress)),
          ...(payload?.playing !== undefined ? { playing: payload.playing } : {}),
        });
      }
    );

    socket.on("disconnect", () => leaveCurrent());
  });

  return io;
}

export function getIo(): Server {
  if (!io) throw new Error("Socket server not initialized");
  return io;
}

export function broadcastSessionState(session: SessionState): void {
  io?.to(roomFor(session.code)).emit("session-state", session);
}

export function broadcastSessionEnded(session: SessionState): void {
  io?.to(roomFor(session.code)).emit("session-ended", { id: session.id });
}

/** Notify everyone the public session list changed (created/started/ended). */
export function broadcastSessionListUpdated(): void {
  io?.emit("session-list-updated");
}
