import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { io, type Socket } from "socket.io-client";

type PlaybackMode = "scroll" | "page";

type Config = {
  adminPassword: string;
  baseUrl: string;
  clients: number;
  durationMs: number;
  metricsIntervalMs: number;
  mode: PlaybackMode;
  pageCount: number;
  pageFlipIntervalMs: number;
  pdfPath: string | null;
  rampMs: number;
  speed: number;
  startPlaying: boolean;
  transports: ("websocket" | "polling")[];
};

type AdminSession = {
  id: string;
  code: string;
};

type MetricsSnapshot = {
  activeSockets: number;
  connectedClients: number;
  totalSessions: number;
  playback?: {
    activeLiveSessions?: number;
  };
  socket?: {
    totalEvents?: number;
    requestSessionStateEvents?: number;
    sessionStateBroadcasts?: number;
  };
};

type ViewerStats = {
  connected: number;
  connectErrors: number;
  disconnected: number;
  joined: number;
  sessionStates: number;
};

type ViewerClient = {
  index: number;
  joined: boolean;
  socket: Socket;
  startedAt: number;
};

function parseArgs(argv: string[]): Map<string, string> {
  const entries = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const value =
      inlineValue !== undefined || nextValue === undefined || nextValue.startsWith("--")
        ? inlineValue ?? "true"
        : nextValue;

    const key = normalizeArgKey(rawKey);
    entries.set(key, value);
    if (inlineValue === undefined && nextValue !== undefined && !nextValue.startsWith("--")) {
      index += 1;
    }
  }

  return entries;
}

function normalizeArgKey(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function readNumber(
  args: Map<string, string>,
  key: string,
  fallback: number
): number {
  const rawValue = args.get(key) ?? process.env[key.toUpperCase()];
  if (rawValue === undefined) return fallback;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for --${key}: ${rawValue}`);
  }
  return value;
}

function readString(
  args: Map<string, string>,
  key: string,
  fallback: string
): string {
  return args.get(key) ?? process.env[key.toUpperCase()] ?? fallback;
}

function readBoolean(
  args: Map<string, string>,
  key: string,
  fallback: boolean
): boolean {
  const rawValue = args.get(key) ?? process.env[key.toUpperCase()];
  if (rawValue === undefined) return fallback;
  return rawValue !== "false" && rawValue !== "0";
}

function readMode(args: Map<string, string>): PlaybackMode {
  const value = readString(args, "mode", "scroll");
  if (value === "scroll" || value === "page") return value;
  throw new Error(`Invalid --mode: ${value}`);
}

function readTransports(args: Map<string, string>): ("websocket" | "polling")[] {
  const rawValue = readString(args, "transports", "websocket");
  const transports = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is "websocket" | "polling" => value === "websocket" || value === "polling");

  if (transports.length === 0) {
    throw new Error(`Invalid --transports: ${rawValue}`);
  }

  return transports;
}

function readConfig(): Config {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("help")) {
    printHelp();
    process.exit(0);
  }

  const adminPassword =
    args.get("admin-password") ??
    process.env.ADMIN_PASSWORD ??
    process.env.LOAD_TEST_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error(
      "Missing admin password. Pass --admin-password or set ADMIN_PASSWORD / LOAD_TEST_ADMIN_PASSWORD."
    );
  }

  return {
    adminPassword,
    baseUrl: readString(args, "base-url", "http://127.0.0.1:3000"),
    clients: readNumber(args, "clients", 300),
    durationMs: readNumber(args, "duration-ms", 30_000),
    metricsIntervalMs: readNumber(args, "metrics-interval-ms", 5_000),
    mode: readMode(args),
    pageCount: readNumber(args, "page-count", 20),
    pageFlipIntervalMs: readNumber(args, "page-flip-interval-ms", 1_000),
    pdfPath: readOptionalPdfPath(args),
    rampMs: readNumber(args, "ramp-ms", 10_000),
    speed: readNumber(args, "speed", 0.0002),
    startPlaying: readBoolean(args, "start-playing", true),
    transports: readTransports(args),
  };
}

function printHelp(): void {
  console.log(`BandScroll load test

Usage:
  npm --prefix server run load:test -- --clients 300

Options:
  --base-url http://127.0.0.1:3000
  --admin-password <password>
  --clients 300
  --ramp-ms 10000
  --duration-ms 30000
  --mode scroll|page
  --page-count 20
  --page-flip-interval-ms 1000
  --pdf-path /absolute/or/relative/file.pdf
  --speed 0.0002
  --metrics-interval-ms 5000
  --start-playing true|false
  --transports websocket|websocket,polling
`);
}

function readOptionalPdfPath(args: Map<string, string>): string | null {
  const rawValue = args.get("pdf-path") ?? process.env.PDF_PATH ?? process.env.LOAD_TEST_PDF_PATH;
  if (!rawValue) return null;
  return resolve(rawValue);
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  expectStatus = 200
): Promise<T> {
  const response = await fetch(url, init);
  if (response.status !== expectStatus) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
  }
  return response.json() as Promise<T>;
}

async function login(baseUrl: string, adminPassword: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword }),
  });

  if (response.status !== 200) {
    throw new Error(`Login failed with status ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Login succeeded but no session cookie was returned");
  }

  return setCookie.split(";")[0];
}

async function createSession(baseUrl: string, cookie: string): Promise<AdminSession> {
  return fetchJson<AdminSession>(
    `${baseUrl}/api/admin/sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        title: `Load test ${new Date().toISOString()}`,
      }),
    },
    201
  );
}

async function uploadPdf(
  baseUrl: string,
  cookie: string,
  sessionId: string,
  pdfPath: string
): Promise<void> {
  const fileBuffer = await readFile(pdfPath);
  const form = new FormData();
  form.append(
    "pdf",
    new Blob([fileBuffer], { type: "application/pdf" }),
    basename(pdfPath)
  );

  const response = await fetch(`${baseUrl}/api/admin/sessions/${sessionId}/pdf`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`PDF upload failed with status ${response.status}: ${body}`);
  }
}

async function fetchMetrics(baseUrl: string, cookie: string): Promise<MetricsSnapshot> {
  return fetchJson<MetricsSnapshot>(`${baseUrl}/api/admin/metrics`, {
    headers: { Cookie: cookie },
  });
}

async function deleteSession(baseUrl: string, cookie: string, sessionId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/admin/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`Delete session failed with status ${response.status}: ${body}`);
  }
}

function connectAdminSocket(baseUrl: string, cookie: string): Promise<Socket> {
  const socket = io(baseUrl, {
    extraHeaders: { Cookie: cookie },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    withCredentials: true,
  });

  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitAdmin(socket: Socket, event: string, payload: unknown): void {
  socket.emit(event, payload);
}

async function configureSession(
  socket: Socket,
  session: AdminSession,
  config: Config
): Promise<void> {
  emitAdmin(socket, "admin-join-session", session.id);
  await sleep(150);
  emitAdmin(socket, "admin-set-speed", { sessionId: session.id, speed: config.speed });

  if (config.mode === "page") {
    emitAdmin(socket, "admin-set-num-pages", {
      sessionId: session.id,
      numPages: config.pageCount,
    });
    emitAdmin(socket, "admin-set-playback-mode", {
      sessionId: session.id,
      playbackMode: "page",
      currentPage: 1,
      progress: 0,
    });
  }

  if (config.startPlaying) {
    emitAdmin(socket, "admin-play", session.id);
  }
}

function connectViewer(
  baseUrl: string,
  sessionCode: string,
  transports: ("websocket" | "polling")[],
  viewerStats: ViewerStats,
  index: number
): ViewerClient {
  const socket = io(baseUrl, {
    autoConnect: true,
    forceNew: true,
    reconnection: false,
    transports,
    withCredentials: true,
  });

  const viewer: ViewerClient = {
    index,
    joined: false,
    socket,
    startedAt: Date.now(),
  };

  socket.on("connect", () => {
    viewerStats.connected += 1;
    socket.emit("join-session", sessionCode);
  });

  socket.on("session-state", () => {
    viewerStats.sessionStates += 1;
    if (!viewer.joined) {
      viewer.joined = true;
      viewerStats.joined += 1;
    }
  });

  socket.on("disconnect", () => {
    viewerStats.disconnected += 1;
  });

  socket.on("connect_error", () => {
    viewerStats.connectErrors += 1;
  });

  return viewer;
}

function formatMetrics(snapshot: MetricsSnapshot | null): string {
  if (!snapshot) return "metrics unavailable";
  return [
    `activeSockets=${snapshot.activeSockets}`,
    `connectedClients=${snapshot.connectedClients}`,
    `totalSessions=${snapshot.totalSessions}`,
    `liveSessions=${snapshot.playback?.activeLiveSessions ?? 0}`,
    `socketEvents=${snapshot.socket?.totalEvents ?? 0}`,
    `resyncRequests=${snapshot.socket?.requestSessionStateEvents ?? 0}`,
    `stateBroadcasts=${snapshot.socket?.sessionStateBroadcasts ?? 0}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const config = readConfig();
  console.log(
    `Using target ${config.baseUrl} with mode=${config.mode} clients=${config.clients}`
  );
  const cookie = await login(config.baseUrl, config.adminPassword);
  const session = await createSession(config.baseUrl, cookie);
  if (config.pdfPath) {
    console.log(`Uploading PDF: ${config.pdfPath}`);
    await uploadPdf(config.baseUrl, cookie, session.id, config.pdfPath);
  }
  const adminSocket = await connectAdminSocket(config.baseUrl, cookie);
  const viewerStats: ViewerStats = {
    connected: 0,
    connectErrors: 0,
    disconnected: 0,
    joined: 0,
    sessionStates: 0,
  };
  const viewers: ViewerClient[] = [];
  const startedAt = Date.now();

  console.log(
    `Starting load test: clients=${config.clients} mode=${config.mode} baseUrl=${config.baseUrl}`
  );
  console.log(`Session code: ${session.code}`);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;

    console.log("\nStopping load test...");
    for (const viewer of viewers) {
      viewer.socket.close();
    }
    adminSocket.close();

    try {
      await deleteSession(config.baseUrl, cookie, session.id);
    } catch (error) {
      console.warn("Cleanup failed:", error);
    }
  };

  process.on("SIGINT", () => {
    void stop().finally(() => process.exit(130));
  });

  await configureSession(adminSocket, session, config);

  const rampDelayMs = config.clients > 0 ? Math.max(0, config.rampMs / config.clients) : 0;
  for (let index = 0; index < config.clients; index += 1) {
    viewers.push(
      connectViewer(config.baseUrl, session.code, config.transports, viewerStats, index)
    );
    if (rampDelayMs > 0) {
      await sleep(rampDelayMs);
    }
  }

  const metricsTimer = setInterval(async () => {
    try {
      const metrics = await fetchMetrics(config.baseUrl, cookie);
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[${elapsedSec}s] joined=${viewerStats.joined}/${config.clients} connected=${viewerStats.connected} errors=${viewerStats.connectErrors} states=${viewerStats.sessionStates} ${formatMetrics(metrics)}`
      );
    } catch (error) {
      console.warn("Metrics poll failed:", error);
    }
  }, config.metricsIntervalMs);

  let pageFlipTimer: NodeJS.Timeout | null = null;
  if (config.mode === "page" && !config.startPlaying) {
    let currentPage = 1;
    pageFlipTimer = setInterval(() => {
      currentPage = currentPage >= config.pageCount ? 1 : currentPage + 1;
      emitAdmin(adminSocket, "admin-set-page", {
        sessionId: session.id,
        page: currentPage,
      });
    }, config.pageFlipIntervalMs);
  }

  await sleep(config.durationMs);

  clearInterval(metricsTimer);
  if (pageFlipTimer) clearInterval(pageFlipTimer);

  const finalMetrics = await fetchMetrics(config.baseUrl, cookie);
  console.log("\nFinal summary");
  console.log(
    [
      `clients=${config.clients}`,
      `joined=${viewerStats.joined}`,
      `connectErrors=${viewerStats.connectErrors}`,
      `disconnects=${viewerStats.disconnected}`,
      `sessionStates=${viewerStats.sessionStates}`,
      formatMetrics(finalMetrics),
    ].join(" ")
  );

  await stop();
}

void main().catch((error: unknown) => {
  console.error("Load test failed:", error);
  process.exitCode = 1;
});
