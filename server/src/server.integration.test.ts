import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createAppServer } from "./app.js";
import { getIo } from "./sockets/socketServer.js";

let httpServer: HttpServer;
let base: string;

const PW = "test-password-123";

beforeAll(async () => {
  ({ httpServer } = createAppServer());
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  // Closing the Socket.IO server force-disconnects clients and closes the
  // underlying HTTP server (httpServer.close() alone would hang on open sockets).
  await new Promise<void>((resolve) => getIo().close(() => resolve()));
});

// ---- helpers ----
// fetch's res.json() is typed `unknown`; these tests assert on loose shapes.
const json = (res: Response): Promise<any> => res.json() as Promise<any>;

async function login(): Promise<string> {
  const res = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers.getSetCookie()[0].split(";")[0];
}

async function createSession(cookie: string, title = "Integration") {
  const res = await fetch(`${base}/api/admin/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  return { status: res.status, body: await json(res) };
}

function connect(extraHeaders?: Record<string, string>): Promise<Socket> {
  const socket = io(base, { transports: ["websocket"], reconnection: false, extraHeaders });
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

  it("rejects admin routes without a session cookie", async () => {
    const res = await fetch(`${base}/api/admin/sessions`);
    expect(res.status).toBe(401);
  });

  it("rejects login with a wrong password", async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
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

    // Newly created (draft) session is immediately public.
    const pub = await json(await fetch(`${base}/api/sessions/public`));
    expect(pub.some((s: any) => s.id === body.id)).toBe(true);

    // start -> live
    const started = await json(
      await fetch(`${base}/api/admin/sessions/${body.id}/start`, {
        method: "POST",
        headers: { Cookie: cookie },
      })
    );
    expect(started.status).toBe("live");
    expect(started.playing).toBe(true);
  });

  it("rejects an unsupported upload type with 400", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie);

    const form = new FormData();
    form.append("pdf", new Blob(["not allowed"], { type: "text/plain" }), "evil.txt");
    const res = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("accepts an image upload and stores it with the right extension", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie);

    const form = new FormData();
    form.append("pdf", new Blob(["\x89PNG\r\n"], { type: "image/png" }), "score.png");
    const updated = await json(
      await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      })
    );
    expect(updated.pdfUrl).toMatch(/^\/uploads\/.+\.png$/);
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

  it("swaps the PDF mid-session: resets progress, pauses, and notifies viewers", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Setlist");
    const upload = async (name: string) => {
      const form = new FormData();
      form.append("pdf", new Blob(["%PDF-1.4"], { type: "application/pdf" }), name);
      return json(
        await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: form,
        })
      );
    };

    const first = await upload("song-a.pdf");
    expect(first.pdfUrl).toMatch(/^\/uploads\/.+\.pdf$/);

    // Advance into the first song, then a viewer joins.
    await fetch(`${base}/api/admin/sessions/${body.id}/start`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    await fetch(`${base}/api/admin/sessions/${body.id}/seek`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
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
    expect(second.playing).toBe(false);
    expect(state.pdfUrl).toBe(second.pdfUrl);
    expect(state.progress).toBe(0);

    viewer.close();
  });
});
