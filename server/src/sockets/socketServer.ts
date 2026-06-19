import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { RequestHandler } from "express";
import {
  clampCurrentPage,
  decrementClientCount,
  getSessionByCode,
  getSessionById,
  incrementClientCount,
  updateSessionState,
  clampProgress,
} from "../sessionStore.js";
import type { SessionState } from "../types.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";

const log = logger.child("socket");

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
    log.info("connect", { id: socket.id, total: metrics.incSocket() });

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
        log.debug("room leave", { id: socket.id, code: session.code });
      }
      joinedSessionId = null;
      counted = false;
    };

    // ---- Public client events ----
    socket.on("join-session", (code: string) => {
      metrics.recordSocketEvent("join-session");
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
      log.info("room join", {
        id: socket.id,
        code: session.code,
        connectedClients: session.connectedClients,
      });
    });

    socket.on("leave-session", () => {
      metrics.recordSocketEvent("leave-session");
      leaveCurrent();
    });

    socket.on("request-session-state", (codeOrId?: string) => {
      metrics.recordSocketEvent("request-session-state");
      const session =
        (joinedSessionId ? getSessionById(joinedSessionId) : undefined) ??
        getSessionByCode(String(codeOrId ?? "")) ??
        getSessionById(String(codeOrId ?? ""));
      if (session) socket.emit("session-state", session);
      else socket.emit("session-not-found", { code: codeOrId });
    });

    // ---- Admin events (server-side authenticated) ----
    const guardAdmin = (event: string): boolean => {
      metrics.recordSocketEvent(event);
      if (isAdminSocket(socket)) return true;
      log.warn("admin denied", { id: socket.id, event });
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
      if (!guardAdmin("admin-join-session")) return;
      const session = getSessionById(String(sessionId ?? ""));
      if (!session) {
        socket.emit("session-not-found", { id: sessionId });
        return;
      }
      socket.join(roomFor(session.code));
      socket.emit("session-state", session);
      log.info("admin join", { id: socket.id, code: session.code });
    });

    socket.on("admin-play", (sessionId: string) => {
      if (!guardAdmin("admin-play")) return;
      adminUpdate(String(sessionId), { playing: true, status: "live" });
      log.info("admin play", { id: socket.id, sessionId: String(sessionId) });
    });

    socket.on("admin-pause", (sessionId: string) => {
      if (!guardAdmin("admin-pause")) return;
      adminUpdate(String(sessionId), { playing: false });
      log.info("admin pause", { id: socket.id, sessionId: String(sessionId) });
    });

    socket.on("admin-stop", (sessionId: string) => {
      if (!guardAdmin("admin-stop")) return;
      adminUpdate(String(sessionId), {
        playing: false,
        progress: 0,
        currentPage: 1,
      });
      log.info("admin stop", { id: socket.id, sessionId: String(sessionId) });
    });

    socket.on(
      "admin-seek",
      (payload: { sessionId: string; progress: number }) => {
        if (!guardAdmin("admin-seek")) return;
        adminUpdate(String(payload?.sessionId), {
          progress: clampProgress(Number(payload?.progress)),
        });
        log.info("admin seek", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          progress: clampProgress(Number(payload?.progress)),
        });
      }
    );

    socket.on(
      "admin-set-playback-mode",
      (payload: {
        sessionId: string;
        playbackMode: SessionState["playbackMode"];
        progress?: number;
        currentPage?: number;
      }) => {
        if (!guardAdmin("admin-set-playback-mode")) return;
        const patch: Parameters<typeof updateSessionState>[1] = {
          playbackMode: payload?.playbackMode === "page" ? "page" : "scroll",
        };
        if (payload?.progress !== undefined) {
          patch.progress = clampProgress(Number(payload.progress));
        }
        if (payload?.currentPage !== undefined) {
          patch.currentPage = clampCurrentPage(Number(payload.currentPage));
        }
        adminUpdate(String(payload?.sessionId), patch);
        log.info("admin set-playback-mode", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          playbackMode: patch.playbackMode,
          currentPage: patch.currentPage,
          progress: patch.progress,
        });
      }
    );

    socket.on(
      "admin-set-page",
      (payload: { sessionId: string; page: number }) => {
        if (!guardAdmin("admin-set-page")) return;
        const currentPage = clampCurrentPage(Number(payload?.page));
        adminUpdate(String(payload?.sessionId), { currentPage });
        log.info("admin set-page", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          currentPage,
        });
      }
    );

    socket.on(
      "admin-set-speed",
      (payload: { sessionId: string; speed: number }) => {
        if (!guardAdmin("admin-set-speed")) return;
        const speed = Math.max(0, Number(payload?.speed) || 0);
        adminUpdate(String(payload?.sessionId), { speed });
        log.info("admin set-speed", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          speed,
        });
      }
    );

    socket.on(
      "admin-set-markers",
      (payload: { sessionId: string; markers: SessionState["markers"] }) => {
        if (!guardAdmin("admin-set-markers")) return;
        const markers = Array.isArray(payload?.markers) ? payload.markers : [];
        adminUpdate(String(payload?.sessionId), { markers });
        log.info("admin set-markers", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          count: markers.length,
        });
      }
    );

    // Lightweight periodic sync sent ~every 250ms while playing. Logged at debug
    // only (dropped at the default level) — throughput is surfaced via the
    // adminSyncEvents counter in the metrics summary instead.
    socket.on(
      "admin-sync",
      (payload: { sessionId: string; progress: number; playing?: boolean }) => {
        if (!guardAdmin("admin-sync")) return;
        adminUpdate(String(payload?.sessionId), {
          progress: clampProgress(Number(payload?.progress)),
          ...(payload?.playing !== undefined ? { playing: payload.playing } : {}),
        });
        log.debug("admin sync", { id: socket.id, sessionId: String(payload?.sessionId) });
      }
    );

    socket.on("disconnect", (reason: string) => {
      leaveCurrent();
      log.info("disconnect", { id: socket.id, reason, total: metrics.decSocket() });
    });
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
