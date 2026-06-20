import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { reportError } from "@/lib/errorLog";

// Single shared socket connection (same origin; cookie sent automatically).
let socket: Socket | null = null;
type SocketTransportState = "idle" | "connecting" | "connected" | "disconnected";

type SocketStatusSnapshot = {
  state: SocketTransportState;
  connected: boolean;
  hasEverConnected: boolean;
  disconnectReason: string | null;
};

let statusSnapshot: SocketStatusSnapshot = {
  state: "idle",
  connected: false,
  hasEverConnected: false,
  disconnectReason: null,
};
const listeners = new Set<() => void>();

function emitStatus(): void {
  listeners.forEach((listener) => listener());
}

function setStatus(partial: Partial<SocketStatusSnapshot>): void {
  statusSnapshot = { ...statusSnapshot, ...partial };
  emitStatus();
}

/**
 * Wire connection-lifecycle breadcrumbs. Normal connects/reconnects are local
 * console breadcrumbs only; genuine failures (connect_error, server/transport
 * disconnects) go through reportError, whose existing 10/min cap keeps a
 * reconnect storm from flooding the server.
 */
function installSocketLogging(s: Socket): void {
  s.on("connect", () => {
    console.debug("[BandScroll:socket] connected", s.id);
    setStatus({
      state: "connected",
      connected: true,
      hasEverConnected: true,
      disconnectReason: null,
    });
  });
  s.on("disconnect", (reason: string) => {
    console.debug("[BandScroll:socket] disconnected", reason);
    setStatus({
      state: "disconnected",
      connected: false,
      disconnectReason: reason,
    });
    // A client-initiated disconnect (logout/reconnect) is expected — skip it.
    if (reason !== "io client disconnect") {
      reportError("socket.disconnect", reason);
    }
  });
  s.on("connect_error", (err) => {
    setStatus({
      state: "disconnected",
      connected: s.connected,
    });
    reportError("socket.connect_error", err);
  });
  s.io.on("reconnect_attempt", (n) => {
    console.debug("[BandScroll:socket] reconnect attempt", n);
    setStatus({
      state: "connecting",
      connected: false,
    });
  });
  s.io.on("reconnect", (n) =>
    console.debug("[BandScroll:socket] reconnected after", n, "attempts")
  );
}

function ensureSocketConnected(s: Socket): void {
  if (s.connected || s.active) return;
  setStatus({
    state: "connecting",
    connected: false,
  });
  s.connect();
}

function getOrCreateSocket(): Socket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      autoConnect: false,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    installSocketLogging(socket);
  }
  return socket;
}

export function getSocket(): Socket {
  const s = getOrCreateSocket();
  ensureSocketConnected(s);
  return s;
}

/**
 * Force a brand-new handshake. Needed after login/logout so the websocket
 * carries (or drops) the admin session cookie — the server reads the session
 * only at connection time.
 */
export function reconnectSocket(): void {
  const s = getOrCreateSocket();
  setStatus({
    state: "connecting",
    connected: false,
    disconnectReason: null,
  });
  s.disconnect();
  s.connect();
}

export function subscribeSocketStatus(listener: () => void): () => void {
  ensureSocketConnected(getOrCreateSocket());
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSocketStatusSnapshot(): SocketStatusSnapshot {
  return statusSnapshot;
}

export function useSocketStatus(): SocketStatusSnapshot {
  return useSyncExternalStore(subscribeSocketStatus, getSocketStatusSnapshot);
}
