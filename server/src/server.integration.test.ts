import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createAppServer } from "./app.js";
import { resetLoginRateLimitState } from "./security/loginRateLimit.js";
import { getIo } from "./sockets/socketServer.js";

let httpServer: HttpServer;
let base: string;

const PW = "test-password-123";

beforeAll(async () => {
  ({ httpServer } = createAppServer());
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  base = `http://localhost:${port}`;
});

afterAll(async () => {
  // Closing the Socket.IO server force-disconnects clients and closes the
  // underlying HTTP server (httpServer.close() alone would hang on open sockets).
  await new Promise<void>((resolve) => getIo().close(() => resolve()));
});

beforeEach(() => {
  resetLoginRateLimitState();
});

// ---- helpers ----
// fetch's res.json() is typed `unknown`; these tests assert on loose shapes.
const json = (res: Response): Promise<any> => res.json() as Promise<any>;

async function login(): Promise<string> {
  const res = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: sameOriginHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers.getSetCookie()[0].split(";")[0];
}

function sameOriginHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  return { Origin: base, ...(extraHeaders ?? {}) };
}

function adminHeaders(
  cookie: string,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  return sameOriginHeaders({ Cookie: cookie, ...(extraHeaders ?? {}) });
}

async function createSession(
  cookie: string,
  title = "Integration",
  extraBody?: Record<string, unknown>
) {
  const res = await fetch(`${base}/api/admin/sessions`, {
    method: "POST",
    headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
    body: JSON.stringify({ title, ...extraBody }),
  });
  return { status: res.status, body: await json(res) };
}

function connect(extraHeaders?: Record<string, string>): Promise<Socket> {
  const socket = io(base, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: sameOriginHeaders(extraHeaders),
  });
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function once<T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForState(
  socket: Socket,
  predicate: (s: any) => boolean,
  timeout = 3000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for state")), timeout);
    const handler = (s: any) => {
      if (predicate(s)) {
        clearTimeout(timer);
        socket.off("session-state", handler);
        resolve(s);
      }
    };
    socket.on("session-state", handler);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- REST ----
describe("REST API", () => {
  it("health check responds ok", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);
  });

  it("accepts client error reports (204)", async () => {
    const res = await fetch(`${base}/api/client-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "test", message: "boom", stack: "x" }),
    });
    expect(res.status).toBe(204);
  });

  it("rejects admin routes without a session cookie", async () => {
    const res = await fetch(`${base}/api/admin/sessions`);
    expect(res.status).toBe(401);
  });

  it("rejects login with a wrong password", async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: sameOriginHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ password: "nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed login attempts", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${base}/api/admin/login`, {
        method: "POST",
        headers: sameOriginHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ password: "wrong-again" }),
      });
      expect(res.status).toBe(401);
    }

    const locked = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: sameOriginHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ password: "still-wrong" }),
    });
    expect(locked.status).toBe(429);
    expect((await json(locked)).error).toBe("login-rate-limit");
  });

  it("resets failed login attempts after a successful login", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${base}/api/admin/login`, {
        method: "POST",
        headers: sameOriginHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ password: "wrong-before-success" }),
      });
      expect(res.status).toBe(401);
    }

    const cookie = await login();
    expect(cookie).toContain("pdfsync.sid=");

    const res = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: sameOriginHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ password: "wrong-after-success" }),
    });
    expect(res.status).toBe(401);
  });

  it("logs in, reports admin via /me, and lists/creates sessions", async () => {
    const cookie = await login();

    const me = await json(await fetch(`${base}/api/admin/me`, { headers: { Cookie: cookie } }));
    expect(me.isAdmin).toBe(true);

    const { status, body } = await createSession(cookie, "Created In Test");
    expect(status).toBe(201);
    expect(body.code).toMatch(/^SESSION-/);
    expect(body.status).toBe("draft");
    expect(body.playbackMode).toBe("scroll");
    expect(body.backgroundMode).toBe("light");
    expect(body.autoStopAtSongEnd).toBe(false);
    expect(body.currentPage).toBe(1);
    expect(body.numPages).toBe(0);
    expect(body.documentDescription).toBeUndefined();

    // Newly created (draft) session is immediately public.
    const pub = await json(await fetch(`${base}/api/sessions/public`));
    expect(pub.some((s: any) => s.id === body.id)).toBe(true);

    // start -> live
    const started = await json(
      await fetch(`${base}/api/admin/sessions/${body.id}/start`, {
        method: "POST",
        headers: adminHeaders(cookie),
      })
    );
    expect(started.status).toBe("live");
    expect(started.playing).toBe(true);
  });

  it("accepts a valid Referer when Origin is absent on an admin mutation", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/api/admin/sessions`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Referer: `${base}/admin`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Referer allowed" }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects admin mutations with a mismatched Origin", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/api/admin/sessions`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Wrong origin" }),
    });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("invalid-origin");
  });

  it("rejects admin mutations when both Origin and Referer are missing", async () => {
    const cookie = await login();
    const res = await fetch(`${base}/api/admin/sessions`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "No origin headers" }),
    });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("invalid-origin");
  });

  it("guards the metrics endpoint and returns process + app stats to admins", async () => {
    const anon = await fetch(`${base}/api/admin/metrics`);
    expect(anon.status).toBe(401);

    const cookie = await login();
    const res = await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const snap = await json(res);
    expect(snap.memory.rssMb).toBeGreaterThan(0);
    expect(typeof snap.socket.requestSessionStateEvents).toBe("number");
    expect(typeof snap.socket.sessionStateBroadcasts).toBe("number");
    expect(typeof snap.playback.activeLiveSessions).toBe("number");
    expect(typeof snap.totalSessions).toBe("number");
    // The request logger's finish handler feeds the registry, so requests counted.
    expect(snap.http.totalRequests).toBeGreaterThan(0);
  });

  it("rejects an unsupported upload type with 400", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie);

    const form = new FormData();
    form.append("pdf", new Blob(["not allowed"], { type: "text/plain" }), "evil.txt");
    const res = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: adminHeaders(cookie),
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("accepts an image upload and stores it with the right extension", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Image upload", {
      documentDescription: "Lead sheet cover image",
    });

    const form = new FormData();
    form.append(
      "pdf",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], { type: "image/png" }),
      "score.png"
    );
    form.append("documentDescription", "Lead sheet cover image");
    const updated = await json(
      await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
        method: "POST",
        headers: adminHeaders(cookie),
        body: form,
      })
    );
    expect(updated.pdfUrl).toMatch(/^\/uploads\/.+\.png$/);
    expect(updated.documentDescription).toBe("Lead sheet cover image");
  });

  it("rejects an image upload without a document description", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie);

    const form = new FormData();
    form.append(
      "pdf",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], { type: "image/png" }),
      "score.png"
    );
    const res = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: adminHeaders(cookie),
      body: form,
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("document-description-required");
  });

  it("sets baseline security headers on app responses", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("keeps nosniff on uploaded files", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "PDF upload");

    const form = new FormData();
    form.append("pdf", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "score.pdf");
    const updated = await json(
      await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
        method: "POST",
        headers: adminHeaders(cookie),
        body: form,
      })
    );

    const fileRes = await fetch(`${base}${updated.pdfUrl}`);
    expect(fileRes.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// ---- Socket auth gating + sync ----
describe("Socket.IO sync", () => {
  it("a viewer joins a room and receives session-state", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Joinable");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    const state = await once<any>(viewer, "session-state");
    expect(state.code).toBe(body.code);
    expect(typeof state.stateVersion).toBe("number");
    viewer.close();
  });

  it("increments connectedClients when a viewer joins", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Counted");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    const count = await once<any>(viewer, "client-count");
    expect(count.sessionId).toBe(body.id);
    expect(count.connectedClients).toBeGreaterThanOrEqual(1);
    viewer.close();
  });

  it("rejects admin events from an unauthenticated socket and does not broadcast them", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Guarded");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    let lastProgress = 0;
    viewer.on("session-state", (s: any) => (lastProgress = s.progress));

    const anon = await connect(); // no cookie -> not admin
    const errP = once(anon, "admin-error");
    anon.emit("admin-seek", { sessionId: body.id, progress: 0.9 });

    await expect(errP).resolves.toBeTruthy();
    await sleep(300);
    expect(lastProgress).not.toBe(0.9);

    viewer.close();
    anon.close();
  });

  it("broadcasts an authenticated admin seek to viewers", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Synced");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    const admin = await connect({ Cookie: cookie }); // handshake carries admin cookie
    admin.emit("admin-join-session", body.id);
    await sleep(150);
    admin.emit("admin-seek", { sessionId: body.id, progress: 0.42 });

    const state = await waitForState(viewer, (s) => Math.abs(s.progress - 0.42) < 1e-6);
    expect(state.progress).toBeCloseTo(0.42, 5);

    viewer.close();
    admin.close();
  });

  it("rejects a websocket handshake from a mismatched Origin", async () => {
    const rejected = io(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: "https://evil.example" },
    });

    await expect(
      new Promise((resolve, reject) => {
        rejected.on("connect", resolve);
        rejected.on("connect_error", reject);
      })
    ).rejects.toBeTruthy();

    rejected.close();
  });

  it("broadcasts page-mode changes and page jumps to viewers", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Paged");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    const admin = await connect({ Cookie: cookie });
    admin.emit("admin-join-session", body.id);
    await sleep(150);
    admin.emit("admin-set-playback-mode", {
      sessionId: body.id,
      playbackMode: "page",
      currentPage: 2,
      progress: 0.4,
    });

    const paged = await waitForState(viewer, (s) => s.playbackMode === "page");
    expect(paged.currentPage).toBe(2);

    admin.emit("admin-set-page", { sessionId: body.id, page: 3 });
    const jumped = await waitForState(viewer, (s) => s.currentPage === 3);
    expect(jumped.playbackMode).toBe("page");

    viewer.close();
    admin.close();
  });

  it("broadcasts background-mode changes to viewers", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Dark stage");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    const admin = await connect({ Cookie: cookie });
    admin.emit("admin-join-session", body.id);
    await sleep(150);
    admin.emit("admin-set-background-mode", {
      sessionId: body.id,
      backgroundMode: "black",
    });

    const updated = await waitForState(viewer, (s) => s.backgroundMode === "black");
    expect(updated.backgroundMode).toBe("black");

    viewer.close();
    admin.close();
  });

  it("broadcasts auto-stop-at-song-end changes to viewers", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Auto stop");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    const admin = await connect({ Cookie: cookie });
    admin.emit("admin-join-session", body.id);
    await sleep(150);
    admin.emit("admin-set-auto-stop-at-song-end", {
      sessionId: body.id,
      autoStopAtSongEnd: true,
    });

    const updated = await waitForState(viewer, (s) => s.autoStopAtSongEnd === true);
    expect(updated.autoStopAtSongEnd).toBe(true);

    viewer.close();
    admin.close();
  });

  it("rejects auto-stop-at-song-end from an unauthenticated socket", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Guard auto stop");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");
    let lastAutoStop = false;
    viewer.on(
      "session-state",
      (s: { autoStopAtSongEnd: boolean }) => (lastAutoStop = s.autoStopAtSongEnd)
    );

    const anon = await connect(); // no cookie -> not admin
    const errP = once(anon, "admin-error");
    anon.emit("admin-set-auto-stop-at-song-end", {
      sessionId: body.id,
      autoStopAtSongEnd: true,
    });

    await expect(errP).resolves.toBeTruthy();
    await sleep(300);
    expect(lastAutoStop).toBe(false);

    viewer.close();
    anon.close();
  });

  it("notifies connected clients when a new session is created", async () => {
    const cookie = await login();
    const listener = await connect();
    let fired = false;
    listener.on("session-list-updated", () => (fired = true));
    await createSession(cookie, "Triggers List Update");
    await sleep(300);
    expect(fired).toBe(true);
    listener.close();
  });

  it("counts request-session-state and authoritative broadcasts", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "ViewerMetrics");

    const before = await json(
      await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: cookie } })
    );

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");
    viewer.emit("request-session-state", body.code);
    await once(viewer, "session-state");

    const after = await json(
      await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: cookie } })
    );

    expect(after.socket.requestSessionStateEvents).toBeGreaterThanOrEqual(
      before.socket.requestSessionStateEvents + 1
    );
    expect(after.socket.sessionStateBroadcasts).toBeGreaterThanOrEqual(
      before.socket.sessionStateBroadcasts + 2
    );

    viewer.close();
  });

  it("rejects page-mode admin events from an unauthenticated socket", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Guarded page");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    let lastState: any = null;
    viewer.on("session-state", (s: any) => {
      lastState = s;
    });

    const anon = await connect();
    const errMode = once(anon, "admin-error");
    anon.emit("admin-set-playback-mode", { sessionId: body.id, playbackMode: "page" });
    await expect(errMode).resolves.toBeTruthy();

    const errPage = once(anon, "admin-error");
    anon.emit("admin-set-page", { sessionId: body.id, page: 4 });
    await expect(errPage).resolves.toBeTruthy();
    await sleep(300);

    expect(lastState?.playbackMode ?? "scroll").toBe("scroll");
    expect(lastState?.currentPage ?? 1).toBe(1);

    viewer.close();
    anon.close();
  });

  it("swaps the PDF mid-session: resets progress, pauses, and notifies viewers", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Setlist");
    const upload = async (name: string) => {
      const form = new FormData();
      form.append("pdf", new Blob(["%PDF-1.4"], { type: "application/pdf" }), name);
      return json(
        await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
          method: "POST",
          headers: adminHeaders(cookie),
          body: form,
        })
      );
    };

    const first = await upload("song-a.pdf");
    expect(first.pdfUrl).toMatch(/^\/uploads\/.+\.pdf$/);

    // Advance into the first song, then a viewer joins.
    await fetch(`${base}/api/admin/sessions/${body.id}/start`, {
      method: "POST",
      headers: adminHeaders(cookie),
    });
    await fetch(`${base}/api/admin/sessions/${body.id}/seek`, {
      method: "POST",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({ progress: 0.6 }),
    });
    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    // Swap to the next song -> viewer must get the new url, progress 0, paused.
    const swap = waitForState(viewer, (s) => s.pdfUrl !== first.pdfUrl);
    const second = await upload("song-b.pdf");
    const state = await swap;

    expect(second.pdfUrl).not.toBe(first.pdfUrl);
    expect(second.progress).toBe(0);
    expect(second.currentPage).toBe(1);
    expect(second.numPages).toBe(0);
    expect(second.playing).toBe(false);
    expect(state.pdfUrl).toBe(second.pdfUrl);
    expect(state.progress).toBe(0);
    expect(state.currentPage).toBe(1);
    expect(state.numPages).toBe(0);

    viewer.close();
  });
});
