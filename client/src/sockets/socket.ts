import { io, type Socket } from "socket.io-client";

// Single shared socket connection (same origin; cookie sent automatically).
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
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
