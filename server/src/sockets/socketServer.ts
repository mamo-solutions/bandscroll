import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { RequestHandler } from "express";
import {
  clampCurrentPage,
  decrementClientCount,
  getSessionByCode,
  getSessionById,
  incrementClientCount,
  listAdminSessions,
  updateSessionState,
  clampProgress,
} from "../sessionStore.js";
import type { SessionState } from "../types.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import {
  nextPlaybackPatch,
  pageStartProgress,
} from "../lib/sessionPlayback.js";

const log = logger.child("socket");

let io: Server | null = null;
let playbackTimer: NodeJS.Timeout | null = null;
const PLAYBACK_LOOP_MS = 250;
const PLAYBACK_SCROLL_TICK_MS = 250;
const PLAYBACK_PAGE_TICK_MS = 500;
const lastPlaybackTickAt = new Map<string, number>();

function roomFor(code: string): string {
  return `session:${code}`;
}

function emitSessionState(socket: Socket, session: SessionState): void {
  metrics.recordSessionStateBroadcast();
  socket.emit("session-state", session);
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

  if (!playbackTimer) {
    playbackTimer = setInterval(() => {
      const now = Date.now();
      for (const session of listAdminSessions()) {
        const cadenceMs =
          session.playbackMode === "page" ? PLAYBACK_PAGE_TICK_MS : PLAYBACK_SCROLL_TICK_MS;
        const lastTickAt = lastPlaybackTickAt.get(session.id) ?? 0;
        if (now - lastTickAt < cadenceMs) continue;
        lastPlaybackTickAt.set(session.id, now);

        const patch = nextPlaybackPatch(session, now);
        if (!patch) continue;
        const updated = updateSessionState(session.id, patch);
        if (updated) broadcastSessionState(updated);
      }
    }, PLAYBACK_LOOP_MS);
    playbackTimer.unref();
    httpServer.on("close", () => {
      if (playbackTimer) {
        clearInterval(playbackTimer);
        playbackTimer = null;
      }
      lastPlaybackTickAt.clear();
    });
  }

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
      emitSessionState(socket, session);
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
      if (session) emitSessionState(socket, session);
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
      emitSessionState(socket, session);
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
      "admin-set-background-mode",
      (payload: {
        sessionId: string;
        backgroundMode: SessionState["backgroundMode"];
      }) => {
        if (!guardAdmin("admin-set-background-mode")) return;
        const backgroundMode = payload?.backgroundMode === "black" ? "black" : "light";
        adminUpdate(String(payload?.sessionId), { backgroundMode });
        log.info("admin set-background-mode", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          backgroundMode,
        });
      }
    );

    socket.on(
      "admin-set-page",
      (payload: { sessionId: string; page: number }) => {
        if (!guardAdmin("admin-set-page")) return;
        const currentPage = clampCurrentPage(Number(payload?.page));
        const session = getSessionById(String(payload?.sessionId));
        if (!session) return;
        const progress =
          session.numPages > 0
            ? pageStartProgress(currentPage, session.numPages)
            : session.progress;
        adminUpdate(String(payload?.sessionId), { currentPage, progress });
        log.info("admin set-page", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          currentPage,
          progress,
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

    socket.on(
      "admin-set-num-pages",
      (payload: { sessionId: string; numPages: number }) => {
        if (!guardAdmin("admin-set-num-pages")) return;
        const numPages = Math.max(0, Math.round(Number(payload?.numPages) || 0));
        const current = getSessionById(String(payload?.sessionId));
        if (!current) return;
        const currentPage =
          numPages > 0 ? Math.min(current.currentPage, numPages) : current.currentPage;
        const progress =
          current.playbackMode === "page" && numPages > 0
            ? Math.min(current.progress, Math.max(0, (currentPage - 1) / numPages))
            : current.progress;
        adminUpdate(String(payload?.sessionId), {
          numPages,
          currentPage,
          progress,
        });
        log.info("admin set-num-pages", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          numPages,
        });
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
  metrics.recordSessionStateBroadcast();
  io?.to(roomFor(session.code)).emit("session-state", session);
}

export function broadcastSessionEnded(session: SessionState): void {
  io?.to(roomFor(session.code)).emit("session-ended", { id: session.id });
}

/** Notify everyone the public session list changed (created/started/ended). */
export function broadcastSessionListUpdated(): void {
  io?.emit("session-list-updated");
}
