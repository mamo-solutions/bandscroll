import { reconnectSocket } from "../sockets/socket";

// Admin auth helpers. The password is sent ONCE to the backend and never stored
// in localStorage/sessionStorage — auth state lives in an http-only cookie.
export const auth = {
  async login(password: string): Promise<boolean> {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    // The shared socket may have connected (anonymously) before this cookie
    // existed. Force a fresh handshake so it carries the admin session and the
    // server authenticates admin events.
    if (res.ok) reconnectSocket();
    return res.ok;
  },

  async logout(): Promise<void> {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "include",
    });
    // Drop admin privileges from the live socket connection too.
    reconnectSocket();
  },

  async me(): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/me", { credentials: "include" });
      if (!res.ok) return false;
      const data = (await res.json()) as { isAdmin: boolean };
      return data.isAdmin === true;
    } catch {
      return false;
    }
  },
};
