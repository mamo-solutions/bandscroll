import { io, type Socket } from "socket.io-client";
import { reportError } from "@/lib/errorLog";

// Single shared socket connection (same origin; cookie sent automatically).
let socket: Socket | null = null;

/**
 * Wire connection-lifecycle breadcrumbs. Normal connects/reconnects are local
 * console breadcrumbs only; genuine failures (connect_error, server/transport
 * disconnects) go through reportError, whose existing 10/min cap keeps a
 * reconnect storm from flooding the server.
 */
function installSocketLogging(s: Socket): void {
  s.on("connect", () => console.debug("[BandScroll:socket] connected", s.id));
  s.on("disconnect", (reason: string) => {
    console.debug("[BandScroll:socket] disconnected", reason);
    // A client-initiated disconnect (logout/reconnect) is expected — skip it.
    if (reason !== "io client disconnect") {
      reportError("socket.disconnect", reason);
    }
  });
  s.io.on("error", (err) => reportError("socket.connect_error", err));
  s.io.on("reconnect_attempt", (n) =>
    console.debug("[BandScroll:socket] reconnect attempt", n)
  );
  s.io.on("reconnect", (n) =>
    console.debug("[BandScroll:socket] reconnected after", n, "attempts")
  );
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    installSocketLogging(socket);
  }
  return socket;
}

/**
 * Force a brand-new handshake. Needed after login/logout so the websocket
 * carries (or drops) the admin session cookie — the server reads the session
 * only at connection time.
 */
export function reconnectSocket(): void {
  const s = getSocket();
  s.disconnect();
  s.connect();
}
