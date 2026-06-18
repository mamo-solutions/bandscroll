import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The reconnect-on-handshake behaviour is the project's documented "critical
// gotcha": the server reads the admin session only at the websocket handshake,
// so login/logout MUST force a fresh handshake or admin events silently stop
// propagating. These tests pin that contract.
const { reconnectSocket } = vi.hoisted(() => ({ reconnectSocket: vi.fn() }));
vi.mock("../sockets/socket", () => ({ reconnectSocket }));

import { auth } from "./auth";

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  reconnectSocket.mockClear();
});

describe("auth.login", () => {
  it("posts the password with credentials and reconnects on success", async () => {
    const fetchFn = mockFetch({ ok: true });

    const result = await auth.login("hunter2");

    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/admin/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ password: "hunter2" }),
      })
    );
    // The socket may have connected anonymously before the cookie existed.
    expect(reconnectSocket).toHaveBeenCalledTimes(1);
  });

  it("does NOT reconnect when login is rejected", async () => {
    mockFetch({ ok: false });

    const result = await auth.login("wrong");

    expect(result).toBe(false);
    expect(reconnectSocket).not.toHaveBeenCalled();
  });
});

describe("auth.logout", () => {
  it("posts logout and reconnects to drop admin privileges from the socket", async () => {
    const fetchFn = mockFetch({ ok: true });

    await auth.logout();

    expect(fetchFn).toHaveBeenCalledWith(
      "/api/admin/logout",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(reconnectSocket).toHaveBeenCalledTimes(1);
  });
});

describe("auth.me", () => {
  it("returns true only when the server reports isAdmin", async () => {
    mockFetch({ ok: true, json: () => Promise.resolve({ isAdmin: true }) });
    await expect(auth.me()).resolves.toBe(true);
  });

  it("returns false when isAdmin is not true", async () => {
    mockFetch({ ok: true, json: () => Promise.resolve({ isAdmin: false }) });
    await expect(auth.me()).resolves.toBe(false);
  });

  it("returns false on a non-ok response", async () => {
    mockFetch({ ok: false });
    await expect(auth.me()).resolves.toBe(false);
  });

  it("swallows network errors and returns false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(auth.me()).resolves.toBe(false);
  });
});
