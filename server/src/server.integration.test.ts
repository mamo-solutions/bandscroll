import type { AddressInfo } from "node:net";
import { createServer, type Server as HttpServer } from "node:http";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { io, type Socket } from "socket.io-client";
import { createAppServer } from "./app.js";
import { getAdminNotificationStore, resetAdminNotificationStoreForTests } from "./ai/adminNotificationStore.js";
import { resetAiConnectorOverrides, setAiConnectorOverride } from "./ai/connectors.js";
import { getAiConfigStore, resetAiConfigStoreForTests } from "./ai/aiConfigStore.js";
import { resetMarkerSuggestionStoreForTests, getMarkerSuggestionStore } from "./ai/markerSuggestionStore.js";
import { env } from "./env.js";
import { clearSessionStore, getSessionById } from "./sessionStore.js";
import { resetLoginRateLimitState } from "./security/loginRateLimit.js";
import { resetAiConfigRateLimitState } from "./security/aiConfigRateLimit.js";
import { resetMarkerGenerationRateLimitState } from "./security/markerGenerationRateLimit.js";
import { getIo } from "./sockets/socketServer.js";
import { RUNTIME_MANIFEST } from "./runtimeManifest.js";

let httpServer: HttpServer;
let base: string;

const PW = "test-password-123";

function resetDirectory(dirPath: string): void {
  rmSync(dirPath, { recursive: true, force: true });
  mkdirSync(dirPath, { recursive: true });
}

function makePngBytes(): Uint8Array {
  const canvas = createCanvas(48, 48);
  try {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffe1c4";
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = "#b95c40";
    ctx.beginPath();
    ctx.arc(24, 24, 14, 0, Math.PI * 2);
    ctx.fill();
    return new Uint8Array(canvas.toBuffer("image/png"));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function makePdfBytes(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 43 >>\nstream\nBT /F1 24 Tf 48 120 Td (BandScroll) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n 
`;
  });
  pdf += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF`;

  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

function makeTwoPagePdfBytes(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Length 43 >>\nstream\nBT /F1 24 Tf 48 120 Td (Cover Page) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 46 >>\nstream\nBT /F1 24 Tf 48 120 Td (Amazing Grace) Tj ET\nendstream",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n 
`;
  });
  pdf += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF`;

  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

beforeAll(async () => {
  const clientDist = resolve(process.cwd(), "../client/dist");
  const indexHtmlPath = resolve(clientDist, "index.html");
  if (!existsSync(indexHtmlPath)) {
    mkdirSync(clientDist, { recursive: true });
    writeFileSync(
      indexHtmlPath,
      `<!doctype html>
<html lang="en">
  <head>
    <title>BandScroll</title>
    <meta name="description" content="Default description." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="BandScroll" />
    <meta property="og:description" content="Default og description." />
    <meta property="og:image" content="/favicon.svg" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="BandScroll" />
    <meta name="twitter:description" content="Default twitter description." />
    <meta name="twitter:image" content="/favicon.svg" />
  </head>
  <body><div id="root"></div></body>
</html>`
    );
  }
  ({ httpServer } = createAppServer());
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  base = `http://localhost:${port}`;
});

afterAll(async () => {
  // Closing the Socket.IO server force-disconnects clients and closes the
  // underlying HTTP server (httpServer.close() alone would hang on open sockets).
  await new Promise<void>((resolve) => getIo().close(() => resolve()));
  resetAiConfigStoreForTests();
  resetAdminNotificationStoreForTests();
  resetMarkerSuggestionStoreForTests();
  resetAiConnectorOverrides();
});

beforeEach(() => {
  resetLoginRateLimitState();
  resetAiConfigRateLimitState();
  resetMarkerGenerationRateLimitState();
  clearSessionStore();
  getAiConfigStore().clear();
  getAdminNotificationStore().clear();
  getMarkerSuggestionStore().clear();
  resetAiConnectorOverrides();
  process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-config-encryption-key";
  resetDirectory(env.UPLOAD_DIR);
  resetDirectory(env.SHARE_PREVIEW_DIR);
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
    auth: RUNTIME_MANIFEST,
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

async function waitForSuggestionSet(
  cookie: string,
  sessionId: string,
  expectedStatus: "running" | "ready" | "error"
): Promise<any> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const res = await fetch(`${base}/api/admin/sessions/${sessionId}/markers/suggestions`, {
      headers: adminHeaders(cookie),
    });
    if (res.status === 200) {
      const body = await json(res);
      if (body.status === expectedStatus) {
        return body;
      }
    }
    await sleep(25);
  }
  throw new Error(`timeout waiting for marker suggestions status ${expectedStatus}`);
}

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

  it("requires admin auth for ai config endpoints", async () => {
    const res = await fetch(`${base}/api/admin/ai/config`);
    expect(res.status).toBe(401);
  });

  it("saves masked AI config summaries and never returns the raw key", async () => {
    const cookie = await login();
    const save = await fetch(`${base}/api/admin/ai/config/openai-compatible`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "top-secret-demo-key",
        baseUrl: "http://localhost:9999/v1",
        defaultModel: "demo-model",
        capabilities: ["marker-generation", "chord-analysis"],
        isDefault: true,
      }),
    });
    expect(save.status).toBe(200);
    const summary = await json(save);
    expect(summary.hasApiKey).toBe(true);
    expect(summary.maskedApiKey).toContain("…");
    expect(JSON.stringify(summary)).not.toContain("top-secret-demo-key");

    const config = await fetch(`${base}/api/admin/ai/config`, {
      headers: adminHeaders(cookie),
    });
    expect(config.status).toBe(200);
    const body = await json(config);
    expect(body.activeProvider).toBe("openai-compatible");
    expect(JSON.stringify(body)).not.toContain("top-secret-demo-key");
  });

  it("rejects AI config writes when encryption is unavailable", async () => {
    const cookie = await login();
    process.env.AI_CONFIG_ENCRYPTION_KEY = "";

    const res = await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({ apiKey: "sk-test" }),
    });

    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("encryption-unavailable");
  });

  it("tests an openai-compatible config against a live provider endpoint", async () => {
    const providerServer = await new Promise<HttpServer>((resolve) => {
      const server = createServer((req, res) => {
        if (req.url === "/v1/models" && req.headers.authorization === "Bearer demo-key") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: [{ id: "model-1" }, { id: "model-2" }] }));
          return;
        }
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "unauthorized" }));
      });
      server.listen(0, () => resolve(server));
    });
    const providerPort = (providerServer.address() as AddressInfo).port;

    try {
      const cookie = await login();
      const save = await fetch(`${base}/api/admin/ai/config/openai-compatible`, {
        method: "PUT",
        headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          apiKey: "demo-key",
          baseUrl: `http://localhost:${providerPort}/v1`,
          defaultModel: "model-1",
          capabilities: ["marker-generation"],
        }),
      });
      expect(save.status).toBe(200);

      const testRes = await fetch(`${base}/api/admin/ai/config/openai-compatible/test`, {
        method: "POST",
        headers: adminHeaders(cookie),
      });
      expect(testRes.status).toBe(200);
      expect(await json(testRes)).toMatchObject({
        ok: true,
        provider: "openai-compatible",
        modelCount: 2,
      });
    } finally {
      await new Promise<void>((resolve) => providerServer.close(() => resolve()));
    }
  });

  it("deletes stored AI config", async () => {
    const cookie = await login();
    await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "sk-delete-me",
        capabilities: ["marker-generation"],
      }),
    });

    const res = await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "DELETE",
      headers: adminHeaders(cookie),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);
  });

  it("generates marker suggestions, persists them, and applies them", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "AI markers");

    await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "sk-demo",
        defaultModel: "gpt-4.1-mini",
        capabilities: ["marker-generation"],
        isDefault: true,
      }),
    });

    setAiConnectorOverride("openai", {
      supportsVision: true,
      supportsJsonMode: true,
      async validateCredential() {
        return { ok: true, provider: "openai", latencyMs: 1, modelCount: 1 };
      },
      async invokeStructured(_config, request) {
        if (request.input.includes("Classify the full document")) {
          return {
            ok: true,
            provider: "openai",
            model: request.model,
            latencyMs: 1,
            data: {
              pages: [
                {
                  page: 1,
                  classification: "front-matter",
                  confidence: 0.95,
                  reason: "Cover page",
                },
                {
                  page: 1,
                  classification: "song-start",
                  title: "Amazing Grace",
                  confidence: 0.93,
                  reason: "New song title",
                },
              ],
            },
          };
        }

        return {
          ok: true,
          provider: "openai",
          model: request.model,
          latencyMs: 1,
          data: {
            suggestions: [
              {
                page: 1,
                title: "Amazing Grace",
                confidence: 0.93,
                reason: "First page of the song",
              },
            ],
          },
        };
      },
    });

    const form = new FormData();
    form.append("pdf", new Blob([makePngBytes()], { type: "image/png" }), "score.png");
    form.append("documentDescription", "Lead sheet image");
    const uploadRes = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: adminHeaders(cookie),
      body: form,
    });
    expect(uploadRes.status).toBe(200);

    const generateRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/generate`, {
      method: "POST",
      headers: adminHeaders(cookie),
    });
    expect(generateRes.status).toBe(202);
    const runningSet = await json(generateRes);
    expect(runningSet.status).toBe("running");

    const suggestionSet = await waitForSuggestionSet(cookie, body.id, "ready");
    expect(suggestionSet.suggestions).toHaveLength(1);
    expect(suggestionSet.suggestions[0].title).toBe("Amazing Grace");

    const notificationsRes = await fetch(`${base}/api/admin/notifications`, {
      headers: adminHeaders(cookie),
    });
    expect(notificationsRes.status).toBe(200);
    const notifications = await json(notificationsRes);
    expect(notifications).toEqual([
      expect.objectContaining({
        sessionId: body.id,
        status: "ready",
        suggestionCount: 1,
      }),
    ]);

    const persistedRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/suggestions`, {
      headers: adminHeaders(cookie),
    });
    expect(persistedRes.status).toBe(200);

    const applyRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/apply-suggestions`, {
      method: "POST",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        suggestions: [
          {
            ...suggestionSet.suggestions[0],
            title: "Amazing Grace (Edited)",
          },
        ],
      }),
    });
    expect(applyRes.status).toBe(200);
    const updated = await json(applyRes);
    expect(updated.markers).toEqual([
      expect.objectContaining({ title: "Amazing Grace (Edited)", page: 1 }),
    ]);

    const missingRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/suggestions`, {
      headers: adminHeaders(cookie),
    });
    expect(missingRes.status).toBe(404);
  });

  it("rejects marker generation when no uploaded document exists", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "No document");

    await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "sk-demo",
        capabilities: ["marker-generation"],
        isDefault: true,
      }),
    });

    const res = await fetch(`${base}/api/admin/sessions/${body.id}/markers/generate`, {
      method: "POST",
      headers: adminHeaders(cookie),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("document-required");
  });

  it("invalidates pending marker suggestions when a new document is uploaded", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Invalidate suggestions");

    await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "sk-demo",
        capabilities: ["marker-generation"],
        isDefault: true,
      }),
    });

    setAiConnectorOverride("openai", {
      supportsVision: true,
      supportsJsonMode: true,
      async validateCredential() {
        return { ok: true, provider: "openai", latencyMs: 1, modelCount: 1 };
      },
      async invokeStructured(_config, request) {
        if (request.input.includes("Classify the full document")) {
          return {
            ok: true,
            provider: "openai",
            model: request.model,
            latencyMs: 1,
            data: {
              pages: [{ page: 1, classification: "song-start", title: "Song", confidence: 0.9, reason: "Title" }],
            },
          };
        }
        return {
          ok: true,
          provider: "openai",
          model: request.model,
          latencyMs: 1,
          data: { suggestions: [{ page: 1, title: "Song", confidence: 0.9, reason: "Title" }] },
        };
      },
    });

    for (const name of ["first.png", "second.png"]) {
      const form = new FormData();
      form.append("pdf", new Blob([makePngBytes()], { type: "image/png" }), name);
      form.append("documentDescription", "Lead sheet image");
      const uploadRes = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
        method: "POST",
        headers: adminHeaders(cookie),
        body: form,
      });
      expect(uploadRes.status).toBe(200);
      if (name === "first.png") {
        const generateRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/generate`, {
          method: "POST",
          headers: adminHeaders(cookie),
        });
        expect(generateRes.status).toBe(202);
        await waitForSuggestionSet(cookie, body.id, "ready");
      }
    }

    const res = await fetch(`${base}/api/admin/sessions/${body.id}/markers/suggestions`, {
      headers: adminHeaders(cookie),
    });
    expect(res.status).toBe(404);
  });

  it("retries marker classification page by page when the batch response is empty", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "AI markers retry");

    await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "sk-demo",
        defaultModel: "gpt-4.1",
        capabilities: ["marker-generation"],
        isDefault: true,
      }),
    });

    let batchCalls = 0;
    let singlePageCalls = 0;
    setAiConnectorOverride("openai", {
      supportsVision: true,
      supportsJsonMode: true,
      async validateCredential() {
        return { ok: true, provider: "openai", latencyMs: 1, modelCount: 1 };
      },
      async invokeStructured(_config, request) {
        if (request.input.includes("Classify the full document")) {
          batchCalls += 1;
          return {
            ok: true,
            provider: "openai",
            model: request.model,
            latencyMs: 1,
            data: { pages: [] },
          };
        }

        if (request.input.includes("Classify page 1 of 2")) {
          singlePageCalls += 1;
          return {
            ok: true,
            provider: "openai",
            model: request.model,
            latencyMs: 1,
            data: {
              page: {
                page: 1,
                classification: "front-matter",
                confidence: 0.92,
                reason: "Cover page",
              },
            },
          };
        }

        if (request.input.includes("Classify page 2 of 2")) {
          singlePageCalls += 1;
          return {
            ok: true,
            provider: "openai",
            model: request.model,
            latencyMs: 1,
            data: {
              page: {
                page: 2,
                classification: "song-start",
                title: "Amazing Grace",
                confidence: 0.94,
                reason: "Large centered title on a new song page",
              },
            },
          };
        }

        return {
          ok: true,
          provider: "openai",
          model: request.model,
          latencyMs: 1,
          data: {
            suggestions: [
              {
                page: 2,
                title: "Amazing Grace",
                confidence: 0.94,
                reason: "First page of the song",
              },
            ],
          },
        };
      },
    });

    const form = new FormData();
    form.append("pdf", new Blob([makeTwoPagePdfBytes()], { type: "application/pdf" }), "score.pdf");
    const uploadRes = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: adminHeaders(cookie),
      body: form,
    });
    expect(uploadRes.status).toBe(200);

    const generateRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/generate`, {
      method: "POST",
      headers: adminHeaders(cookie),
    });
    expect(generateRes.status).toBe(202);
    const suggestionSet = await waitForSuggestionSet(cookie, body.id, "ready");
    expect(batchCalls).toBe(1);
    expect(singlePageCalls).toBe(2);
    expect(suggestionSet.suggestions).toEqual([
      expect.objectContaining({
        title: "Amazing Grace",
        page: 2,
      }),
    ]);
  });

  it("acknowledges unread marker-generation notifications", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "AI notifications");

    await fetch(`${base}/api/admin/ai/config/openai`, {
      method: "PUT",
      headers: adminHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        apiKey: "sk-demo",
        capabilities: ["marker-generation"],
        isDefault: true,
      }),
    });

    setAiConnectorOverride("openai", {
      supportsVision: true,
      supportsJsonMode: true,
      async validateCredential() {
        return { ok: true, provider: "openai", latencyMs: 1, modelCount: 1 };
      },
      async invokeStructured(_config, request) {
        if (request.input.includes("Classify the full document")) {
          return {
            ok: true,
            provider: "openai",
            model: request.model,
            latencyMs: 1,
            data: {
              pages: [
                {
                  page: 1,
                  classification: "song-start",
                  title: "Song",
                  confidence: 0.9,
                  reason: "Title",
                },
              ],
            },
          };
        }
        return {
          ok: true,
          provider: "openai",
          model: request.model,
          latencyMs: 1,
          data: { suggestions: [{ page: 1, title: "Song", confidence: 0.9, reason: "Title" }] },
        };
      },
    });

    const form = new FormData();
    form.append("pdf", new Blob([makePngBytes()], { type: "image/png" }), "score.png");
    form.append("documentDescription", "Lead sheet image");
    const uploadRes = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: adminHeaders(cookie),
      body: form,
    });
    expect(uploadRes.status).toBe(200);

    const generateRes = await fetch(`${base}/api/admin/sessions/${body.id}/markers/generate`, {
      method: "POST",
      headers: adminHeaders(cookie),
    });
    expect(generateRes.status).toBe(202);
    await waitForSuggestionSet(cookie, body.id, "ready");

    const notificationsRes = await fetch(`${base}/api/admin/notifications`, {
      headers: adminHeaders(cookie),
    });
    const notifications = await json(notificationsRes);
    expect(notifications).toHaveLength(1);

    const ackRes = await fetch(`${base}/api/admin/notifications/${notifications[0].id}/ack`, {
      method: "POST",
      headers: adminHeaders(cookie),
    });
    expect(ackRes.status).toBe(200);
    expect((await json(ackRes)).ok).toBe(true);

    const afterAckRes = await fetch(`${base}/api/admin/notifications`, {
      headers: adminHeaders(cookie),
    });
    expect(afterAckRes.status).toBe(200);
    expect(await json(afterAckRes)).toEqual([]);
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
      new Blob([makePngBytes()], { type: "image/png" }),
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
    const sessionPage = await (await fetch(`${base}/session/${updated.code}`)).text();
    expect(sessionPage).toContain(`/share-previews/${updated.code}.png?v=`);
    expect(sessionPage).toContain('name="twitter:card" content="summary_large_image"');

    const shareImageUrl = sessionPage.match(/https?:\/\/[^"]+\/share-previews\/[^"]+/)?.[0];
    expect(shareImageUrl).toBeTruthy();
    const previewUrl = new URL(shareImageUrl!);
    const previewRes = await fetch(`${base}${previewUrl.pathname}${previewUrl.search}`);
    expect(previewRes.status).toBe(200);
    expect(previewRes.headers.get("content-type")).toContain("image/png");
  });

  it("rejects an image upload without a document description", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie);

    const form = new FormData();
    form.append(
      "pdf",
      new Blob([makePngBytes()], { type: "image/png" }),
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

  it("creates a share preview from a PDF upload", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "PDF share preview");

    const form = new FormData();
    form.append("pdf", new Blob([makePdfBytes()], { type: "application/pdf" }), "score.pdf");
    const updated = await json(
      await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
        method: "POST",
        headers: adminHeaders(cookie),
        body: form,
      })
    );

    const sessionPage = await (await fetch(`${base}/session/${updated.code}`)).text();
    const shareImageUrl = sessionPage.match(/https?:\/\/[^"]+\/share-previews\/[^"]+/)?.[0];
    expect(shareImageUrl).toBeTruthy();
    expect(sessionPage).toContain('property="og:image"');
    const previewUrl = new URL(shareImageUrl!);
    const previewRes = await fetch(`${base}${previewUrl.pathname}${previewUrl.search}`);
    expect(previewRes.status).toBe(200);
    expect(previewRes.headers.get("content-type")).toContain("image/png");
  });

  it("serves session-specific share metadata even with a trailing slash", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Trailing slash session", {
      description: "Trailing slash description",
    });

    const res = await fetch(`${base}/session/${body.code}/`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("Trailing slash session · BandScroll");
    expect(html).toContain("Trailing slash description");
  });

  it("updates the preview cache-buster when the uploaded document changes", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Swap preview", {
      documentDescription: "Lead sheet cover image",
    });

    const upload = async (blob: Blob, name: string) => {
      const form = new FormData();
      form.append("pdf", blob, name);
      form.append("documentDescription", "Lead sheet cover image");
      return json(
        await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
          method: "POST",
          headers: adminHeaders(cookie),
          body: form,
        })
      );
    };

    const first = await upload(new Blob([makePngBytes()], { type: "image/png" }), "first.png");
    const firstPage = await (await fetch(`${base}/session/${first.code}`)).text();
    const firstPreview = firstPage.match(/https?:\/\/[^"]+\/share-previews\/[^"]+/)?.[0];

    const second = await upload(new Blob([makePdfBytes()], { type: "application/pdf" }), "second.pdf");
    const secondPage = await (await fetch(`${base}/session/${second.code}`)).text();
    const secondPreview = secondPage.match(/https?:\/\/[^"]+\/share-previews\/[^"]+/)?.[0];

    expect(firstPreview).toBeTruthy();
    expect(secondPreview).toBeTruthy();
    expect(secondPreview).not.toBe(firstPreview);
  });

  it("rejects a truncated image before native preview rendering", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Broken preview", {
      documentDescription: "Lead sheet cover image",
    });

    const form = new FormData();
    form.append(
      "pdf",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], { type: "image/png" }),
      "broken.png"
    );
    form.append("documentDescription", "Lead sheet cover image");
    const uploadRes = await fetch(`${base}/api/admin/sessions/${body.id}/pdf`, {
      method: "POST",
      headers: adminHeaders(cookie),
      body: form,
    });
    expect(uploadRes.status).toBe(400);
    expect((await json(uploadRes)).error).toBe("pdf-content-mismatch");
  });
});

// ---- Socket auth gating + sync ----
describe("Socket.IO sync", () => {
  it("acknowledges public debug pings without changing session state", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Diagnostic ping");
    const before = structuredClone(getSessionById(body.id));
    const viewer = await connect();
    const requestedAt = Date.now();

    const response = await viewer.emitWithAck<{ serverReceivedAt: number }>("debug-ping");

    expect(response.serverReceivedAt).toBeGreaterThanOrEqual(requestedAt);
    expect(response.serverReceivedAt).toBeLessThanOrEqual(Date.now());
    expect(getSessionById(body.id)).toEqual(before);
    viewer.close();
  });

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

  it("broadcasts an authenticated admin pause with the supplied scroll anchor", async () => {
    const cookie = await login();
    const { body } = await createSession(cookie, "Paused anchor");

    const viewer = await connect();
    viewer.emit("join-session", body.code);
    await once(viewer, "session-state");

    const admin = await connect({ Cookie: cookie });
    admin.emit("admin-join-session", body.id);
    await sleep(150);
    admin.emit("admin-pause", {
      sessionId: body.id,
      progress: 0.42,
      scrollAnchor: { page: 3, fraction: 0.25 },
    });

    const state = await waitForState(
      viewer,
      (s) =>
        Math.abs(s.progress - 0.42) < 1e-6 &&
        s.playing === false &&
        s.scrollAnchor?.page === 3 &&
        Math.abs((s.scrollAnchor?.fraction ?? 0) - 0.25) < 1e-6
    );
    expect(state.progress).toBeCloseTo(0.42, 5);
    expect(state.playing).toBe(false);
    expect(state.scrollAnchor).toEqual({ page: 3, fraction: 0.25 });

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

  it("rejects a websocket handshake from an outdated client build", async () => {
    const rejected = io(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: sameOriginHeaders(),
      auth: { ...RUNTIME_MANIFEST, buildId: "outdated-build" },
    });

    await expect(
      new Promise((resolve, reject) => {
        rejected.on("connect", resolve);
        rejected.on("connect_error", reject);
      })
    ).rejects.toMatchObject({ message: "client-update-required" });

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
