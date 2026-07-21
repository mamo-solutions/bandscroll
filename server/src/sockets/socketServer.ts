import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { RequestHandler } from "express";
import {
  clampCurrentPage,
  CANONICAL_SCROLL_VELOCITY_DEFAULT,
  clampCanonicalScrollVelocity,
  decrementClientCount,
  getSessionByCode,
  getSessionById,
  incrementClientCount,
  listAdminSessions,
  updateSessionState,
  clampProgress,
  type SessionPatch,
} from "../sessionStore.js";
import type { SessionState, SyncSnapshot } from "../types.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import type { MarkerGenerationSocketEvent } from "../ai/types.js";
import {
  nextPlaybackPatch,
  pageStartProgress,
} from "../lib/sessionPlayback.js";
import { maxCursorMicroPoints, pageForDocumentCursor } from "../lib/documentPosition.js";
import { isAllowedSocketOrigin } from "../security/origin.js";
import { readSessionDocumentGeometry } from "../ai/documentAnalysis.js";
import { applyCanonicalControl, type CanonicalControlCommand } from "../lib/sessionControl.js";
import { createSyncSnapshot, materializeDocumentCursor } from "../lib/syncSnapshot.js";
import { RUNTIME_MANIFEST } from "../runtimeManifest.js";

const log = logger.child("socket");

let io: Server | null = null;
let playbackTimer: NodeJS.Timeout | null = null;
const PLAYBACK_LOOP_MS = 250;
const PLAYBACK_SCROLL_TICK_MS = 250;
const PLAYBACK_PAGE_TICK_MS = 500;
const lastPlaybackTickAt = new Map<string, number>();
const positionSequenceBySession = new Map<string, number>();
const controllerBySession = new Map<string, { socketId: string; expiresAt: number }>();
const CONTROLLER_LEASE_MS = 15_000;
const ADMIN_ROOM = "admins";

export type DebugPingResponse = {
  serverReceivedAt: number;
};

function roomFor(code: string): string {
  return `session:${code}`;
}

function nextPositionSequence(sessionId: string): number {
  const next = (positionSequenceBySession.get(sessionId) ?? 0) + 1;
  positionSequenceBySession.set(sessionId, next);
  return next;
}

function snapshotForSession(session: SessionState, now = Date.now()): SyncSnapshot {
  return createSyncSnapshot(session, nextPositionSequence(session.id), now);
}

function emitSessionState(socket: Socket, session: SessionState): void {
  metrics.recordSessionStateBroadcast();
  socket.emit("session-state", snapshotForSession(session));
}

function hydrateCanonicalGeometry(session: SessionState): void {
  if (session.documentGeometry || !session.pdfUrl) return;
  void readSessionDocumentGeometry(session)
    .then((geometry) => {
      if (!geometry) return;
      const anchor = session.scrollAnchor;
      const pageIndex = anchor ? Math.max(0, Math.min(geometry.pageHeightsPoints.length - 1, anchor.page - 1)) : 0;
      const beforePage = geometry.pageHeightsPoints.slice(0, pageIndex).reduce((sum, height) => sum + height, 0);
      // Legacy conversion happens exactly once during migration; runtime state
      // thereafter never uses a percentage or viewport-derived value.
      const legacyPoints = anchor
        ? beforePage + geometry.pageHeightsPoints[pageIndex] * anchor.fraction
        : geometry.totalHeightPoints * session.progress;
      const updated = updateSessionState(session.id, {
        documentGeometry: geometry,
        documentCursor: { revision: geometry.revision, yMicroPoints: Math.round(legacyPoints * 1_000) },
        scrollVelocityPointsPerSecond: CANONICAL_SCROLL_VELOCITY_DEFAULT,
        positionUpdatedAt: Date.now(),
        playing: false,
      });
      if (updated) broadcastSessionState(updated);
    })
    .catch((err) => log.warn("document geometry migration failed", { sessionId: session.id, err }));
}

/** Materialize an older velocity before applying the current safe range. */
function enforceCanonicalScrollVelocity(session: SessionState): SessionState {
  if (!session.documentGeometry || !session.documentCursor) return session;
  const currentVelocity = session.scrollVelocityPointsPerSecond ?? CANONICAL_SCROLL_VELOCITY_DEFAULT;
  const clampedVelocity = clampCanonicalScrollVelocity(currentVelocity);
  if (currentVelocity === clampedVelocity) return session;

  const now = Date.now();
  return (
    updateSessionState(session.id, {
      documentCursor: materializeDocumentCursor(session, now),
      positionUpdatedAt: now,
      scrollVelocityPointsPerSecond: clampedVelocity,
    }) ?? session
  );
}

type AdminPlaybackControlPayload =
  | string
  | {
      sessionId?: string;
      progress?: number;
      scrollAnchor?: { page: number; fraction: number };
      currentPage?: number;
    };

function playbackControlSessionId(payload: AdminPlaybackControlPayload): string {
  return typeof payload === "string" ? payload : String(payload?.sessionId);
}

function playbackControlPatch(
  payload: AdminPlaybackControlPayload
): Pick<SessionPatch, "progress" | "scrollAnchor" | "currentPage"> {
  if (typeof payload === "string") return {};

  const patch: Pick<SessionPatch, "progress" | "scrollAnchor" | "currentPage"> = {};

  if (payload?.progress !== undefined) {
    patch.progress = clampProgress(Number(payload.progress));
  }

  if (
    payload?.scrollAnchor &&
    Number.isFinite(payload.scrollAnchor.page) &&
    Number.isFinite(payload.scrollAnchor.fraction)
  ) {
    patch.scrollAnchor = payload.scrollAnchor;
  }

  if (payload?.currentPage !== undefined && Number.isFinite(payload.currentPage)) {
    patch.currentPage = clampCurrentPage(Number(payload.currentPage));
  }

  return patch;
}

/** True if this socket's shared express-session is an authenticated admin. */
function isAdminSocket(socket: Socket): boolean {
  // express-session is attached to the underlying request via engine middleware.
  const req = socket.request as unknown as { session?: { isAdmin?: boolean } };
  return req.session?.isAdmin === true;
}

function claimController(socket: Socket, sessionId: string): boolean {
  const controller = controllerBySession.get(sessionId);
  if (!controller || controller.expiresAt <= Date.now() || controller.socketId === socket.id) {
    controllerBySession.set(sessionId, { socketId: socket.id, expiresAt: Date.now() + CONTROLLER_LEASE_MS });
    return true;
  }
  socket.emit("admin-error", { error: "controller-active" });
  return false;
}

function rejectsLegacyScrollControl(socket: Socket, sessionId: string): boolean {
  const session = getSessionById(sessionId);
  if (!session || session.playbackMode !== "scroll" || !session.documentGeometry) return false;
  socket.emit("admin-error", { error: "canonical-scroll-command-required" });
  emitSessionState(socket, session);
  return true;
}

export function initSocketServer(
  httpServer: HttpServer,
  sessionMiddleware: RequestHandler
): Server {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isAllowedSocketOrigin(origin)),
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
      callback(null, isAllowedSocketOrigin(originHeader));
    },
  });

  // Share the express-session middleware so socket.request.session is populated.
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const runtime = socket.handshake.auth as { syncProtocol?: unknown; buildId?: unknown };
    if (
      runtime.syncProtocol === RUNTIME_MANIFEST.syncProtocol &&
      runtime.buildId === RUNTIME_MANIFEST.buildId
    ) {
      next();
      return;
    }

    const error = new Error("client-update-required") as Error & {
      data: typeof RUNTIME_MANIFEST;
    };
    error.data = RUNTIME_MANIFEST;
    next(error);
  });

  if (!playbackTimer) {
    playbackTimer = setInterval(() => {
      const now = Date.now();
      for (const session of listAdminSessions()) {
        const cadenceMs =
          session.playbackMode === "page" ? PLAYBACK_PAGE_TICK_MS : PLAYBACK_SCROLL_TICK_MS;
        const lastTickAt = lastPlaybackTickAt.get(session.id) ?? 0;
        if (now - lastTickAt < cadenceMs) continue;
        lastPlaybackTickAt.set(session.id, now);

        if (session.playbackMode === "scroll" && session.documentGeometry && session.documentCursor) {
          const cursor = materializeDocumentCursor(session, now);
          if (!cursor) continue;
          const autoStopCursor = nextCanonicalAutoStopCursor(session, cursor);
          if (autoStopCursor || cursor.yMicroPoints >= maxCursorMicroPoints(session.documentGeometry)) {
            const terminalCursor = autoStopCursor ?? cursor;
            const updated = updateSessionState(session.id, {
              documentCursor: terminalCursor,
              positionUpdatedAt: now,
              currentPage: pageForDocumentCursor(terminalCursor, session.documentGeometry),
              playing: false,
            });
            if (updated) broadcastSessionState(updated);
          } else if (session.playing && (session.scrollVelocityPointsPerSecond ?? 0) > 0) {
            // Canonical playback snapshots are deliberately ephemeral. Persisting
            // every tick causes storage latency and makes state versions churn.
            broadcastSessionState(session, now);
          }
          continue;
        }

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
      positionSequenceBySession.clear();
    });
  }

  io.on("connection", (socket) => {
    log.info("connect", { id: socket.id, total: metrics.incSocket() });
    if (isAdminSocket(socket)) {
      socket.join(ADMIN_ROOM);
      log.debug("admin room join", { id: socket.id });
    }

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
      let session = getSessionByCode(String(code ?? ""));
      if (!session) {
        socket.emit("session-not-found", { code });
        return;
      }
      hydrateCanonicalGeometry(session);
      session = enforceCanonicalScrollVelocity(session);
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

    // Deliberately independent of session membership and controller state so
    // diagnostics can measure transport RTT without touching synchronization.
    socket.on("debug-ping", (acknowledge: (response: DebugPingResponse) => void) => {
      metrics.recordSocketEvent("debug-ping");
      acknowledge({ serverReceivedAt: Date.now() });
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
      let session = getSessionById(String(sessionId ?? ""));
      if (!session) {
        socket.emit("session-not-found", { id: sessionId });
        return;
      }
      session = enforceCanonicalScrollVelocity(session);
      socket.join(roomFor(session.code));
      emitSessionState(socket, session);
      log.info("admin join", { id: socket.id, code: session.code });
    });

    socket.on("admin-play", (payload: AdminPlaybackControlPayload) => {
      if (!guardAdmin("admin-play")) return;
      const sessionId = playbackControlSessionId(payload);
      if (rejectsLegacyScrollControl(socket, sessionId)) return;
      adminUpdate(sessionId, { playing: true, status: "live", ...playbackControlPatch(payload) });
      log.info("admin play", { id: socket.id, sessionId });
    });

    socket.on("admin-pause", (payload: AdminPlaybackControlPayload) => {
      if (!guardAdmin("admin-pause")) return;
      const sessionId = playbackControlSessionId(payload);
      if (rejectsLegacyScrollControl(socket, sessionId)) return;
      adminUpdate(sessionId, { playing: false, ...playbackControlPatch(payload) });
      log.info("admin pause", { id: socket.id, sessionId });
    });

    socket.on("admin-stop", (sessionId: string) => {
      if (!guardAdmin("admin-stop")) return;
      if (rejectsLegacyScrollControl(socket, String(sessionId))) return;
      adminUpdate(String(sessionId), {
        playing: false,
        progress: 0,
        scrollAnchor: { page: 1, fraction: 0 },
        currentPage: 1,
      });
      log.info("admin stop", { id: socket.id, sessionId: String(sessionId) });
    });

    socket.on(
      "admin-seek",
      (payload: {
        sessionId: string;
        progress: number;
        scrollAnchor?: { page: number; fraction: number };
      }) => {
        if (!guardAdmin("admin-seek")) return;
        if (rejectsLegacyScrollControl(socket, String(payload?.sessionId))) return;
        const patch: Parameters<typeof updateSessionState>[1] = {
          progress: clampProgress(Number(payload?.progress)),
        };
        if (
          payload?.scrollAnchor &&
          Number.isFinite(payload.scrollAnchor.page) &&
          Number.isFinite(payload.scrollAnchor.fraction)
        ) {
          patch.scrollAnchor = payload.scrollAnchor;
        }
        adminUpdate(String(payload?.sessionId), patch);
        log.info("admin seek", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          progress: clampProgress(Number(payload?.progress)),
        });
      }
    );

    // Positions are never accepted as a browser heartbeat. A conductor sends
    // discrete cursor commands with the immutable PDF revision it observed.
    socket.on("admin-sync", () => {
      socket.emit("admin-error", { error: "admin-sync-retired" });
    });

    socket.on(
      "admin-control",
      (payload: { sessionId: string } & CanonicalControlCommand) => {
        if (!guardAdmin("admin-control")) return;
        const sessionId = String(payload?.sessionId);
        if (!claimController(socket, sessionId)) return;
        const session = getSessionById(sessionId);
        if (!session) {
          socket.emit("session-not-found", { id: sessionId });
          return;
        }
        const result = applyCanonicalControl(session, payload);
        if ("error" in result) {
          socket.emit("admin-error", { error: result.error, session });
          emitSessionState(socket, session);
          return;
        }
        adminUpdate(session.id, result.patch);
      }
    );

    socket.on("admin-control-lease", (sessionId: string) => {
      if (!guardAdmin("admin-control-lease")) return;
      claimController(socket, String(sessionId));
    });

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
      "admin-set-auto-stop-at-song-end",
      (payload: { sessionId: string; autoStopAtSongEnd: boolean }) => {
        if (!guardAdmin("admin-set-auto-stop-at-song-end")) return;
        const autoStopAtSongEnd = Boolean(payload?.autoStopAtSongEnd);
        adminUpdate(String(payload?.sessionId), { autoStopAtSongEnd });
        log.info("admin set-auto-stop-at-song-end", {
          id: socket.id,
          sessionId: String(payload?.sessionId),
          autoStopAtSongEnd,
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
      (payload: { sessionId: string; speed: number; velocityPointsPerSecond?: number }) => {
        if (!guardAdmin("admin-set-speed")) return;
        const speed = Math.max(0, Number(payload?.speed) || 0);
        const velocityPointsPerSecond = Math.max(0, Number(payload?.velocityPointsPerSecond) || 0);
        adminUpdate(String(payload?.sessionId), {
          speed,
          ...(velocityPointsPerSecond > 0 ? { scrollVelocityPointsPerSecond: velocityPointsPerSecond } : {}),
        });
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
      for (const [sessionId, controllerId] of controllerBySession) {
        if (controllerId.socketId === socket.id) controllerBySession.delete(sessionId);
      }
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

function nextCanonicalAutoStopCursor(
  session: SessionState,
  cursor: NonNullable<SessionState["documentCursor"]>
): NonNullable<SessionState["documentCursor"]> | undefined {
  const target = session.autoStopCursor;
  if (!session.autoStopAtSongEnd || !target || !session.documentCursor) return undefined;
  if (target.revision !== session.documentCursor.revision) return undefined;
  if (target.yMicroPoints <= session.documentCursor.yMicroPoints) return undefined;
  return target.yMicroPoints <= cursor.yMicroPoints ? target : undefined;
}

export function broadcastSessionState(session: SessionState, now = Date.now()): void {
  metrics.recordSessionStateBroadcast();
  io?.to(roomFor(session.code)).emit("session-state", snapshotForSession(session, now));
}

export function broadcastSessionEnded(session: SessionState): void {
  io?.to(roomFor(session.code)).emit("session-ended", { id: session.id });
}

/** Notify everyone the public session list changed (created/started/ended). */
export function broadcastSessionListUpdated(): void {
  io?.emit("session-list-updated");
}

export function broadcastAdminMarkerGenerationUpdated(
  payload: MarkerGenerationSocketEvent
): void {
  io?.to(ADMIN_ROOM).emit("admin-marker-generation-updated", payload);
}
