import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { io, type Socket } from "socket.io-client";

type PlaybackMode = "scroll" | "page";

type Config = {
  adminPassword: string;
  batchSize: number;
  baseUrl: string;
  clients: number;
  durationMs: number;
  exerciseControls: boolean;
  metricsIntervalMs: number;
  lateJoinClients: number;
  lateJoinBatchDelayMs: number;
  lateJoinDelayMs: number;
  mode: PlaybackMode;
  pageCount: number;
  pageFlipIntervalMs: number;
  pdfPath: string | null;
  rampMs: number;
  reconnectClients: number;
  speed: number;
  startPlaying: boolean;
  transports: ("websocket" | "polling")[];
  verifyTimeoutMs: number;
};

type AdminSession = {
  id: string;
  code: string;
  controlVersion?: number;
  documentGeometry?: {
    revision: string;
  };
};

type RuntimeManifest = {
  syncProtocol: number;
  buildId: string;
};

type DocumentCursor = {
  revision: string;
  yMicroPoints: number;
};

type SyncSnapshot = AdminSession & {
  playing: boolean;
  documentCursor?: DocumentCursor;
  documentGeometry?: {
    revision: string;
    pageHeightsPoints: number[];
    totalHeightPoints: number;
  };
  positionSequence: number;
  serverTimestamp: number;
  scrollVelocityPointsPerSecond?: number;
  markers?: Array<{ id: string; page: number }>;
};

type AdminSocketError = {
  error?: string;
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
  snapshotErrors: string[];
};

type ViewerClient = {
  firstCursor?: DocumentCursor;
  index: number;
  joined: boolean;
  lastPositionSequence: number;
  socket: Socket;
  startedAt: number;
};

type AdminObserver = {
  dispose: () => void;
  latest: () => SyncSnapshot | null;
  waitForSnapshot: (
    label: string,
    predicate: (snapshot: SyncSnapshot) => boolean,
    timeoutMs: number
  ) => Promise<SyncSnapshot>;
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

  const clients = readNumber(args, "clients", 300);
  const lateJoinClients = Math.max(
    0,
    Math.min(clients, readNumber(args, "late-join-clients", Math.min(20, Math.floor(clients / 5))))
  );

  return {
    adminPassword,
    batchSize: Math.max(1, Math.round(readNumber(args, "batch-size", 15))),
    baseUrl: readString(args, "base-url", "http://127.0.0.1:3000"),
    clients,
    durationMs: readNumber(args, "duration-ms", 30_000),
    exerciseControls: readBoolean(args, "exercise-controls", true),
    metricsIntervalMs: readNumber(args, "metrics-interval-ms", 5_000),
    lateJoinClients,
    lateJoinBatchDelayMs: Math.max(0, readNumber(args, "late-join-batch-delay-ms", 250)),
    lateJoinDelayMs: Math.max(0, readNumber(args, "late-join-delay-ms", 2_000)),
    mode: readMode(args),
    pageCount: readNumber(args, "page-count", 20),
    pageFlipIntervalMs: readNumber(args, "page-flip-interval-ms", 1_000),
    pdfPath: readOptionalPdfPath(args),
    rampMs: readNumber(args, "ramp-ms", 10_000),
    reconnectClients: readNumber(args, "reconnect-clients", 1),
    speed: readNumber(args, "speed", 36),
    startPlaying: readBoolean(args, "start-playing", true),
    transports: readTransports(args),
    verifyTimeoutMs: readNumber(args, "verify-timeout-ms", 10_000),
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
  --batch-size 15
  --ramp-ms 10000
  --duration-ms 30000
  --exercise-controls true
  --mode scroll|page
  --page-count 20
  --page-flip-interval-ms 1000
  --pdf-path /absolute/or/relative/file.pdf
  --speed 36                         PDF points per second (scroll mode)
  --metrics-interval-ms 5000
  --late-join-clients 20
  --late-join-delay-ms 2000
  --late-join-batch-delay-ms 250
  --reconnect-clients 1
  --start-playing true|false
  --transports websocket|websocket,polling
  --verify-timeout-ms 10000
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

function originHeaders(baseUrl: string, extraHeaders?: Record<string, string>): Record<string, string> {
  return { Origin: new URL(baseUrl).origin, ...(extraHeaders ?? {}) };
}

function createAdminObserver(socket: Socket, sessionId: string): AdminObserver {
  let latestSnapshot: SyncSnapshot | null = null;
  let latestError: string | null = null;

  const onState = (snapshot: SyncSnapshot) => {
    if (snapshot.id === sessionId) latestSnapshot = snapshot;
  };
  const onError = (payload: AdminSocketError) => {
    latestError = payload.error ?? "unknown-admin-error";
  };

  socket.on("session-state", onState);
  socket.on("admin-error", onError);

  return {
    dispose: () => {
      socket.off("session-state", onState);
      socket.off("admin-error", onError);
    },
    latest: () => latestSnapshot,
    waitForSnapshot: async (label, predicate, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (latestError) {
          throw new Error(`Admin command failed while waiting for ${label}: ${latestError}`);
        }
        if (latestSnapshot && predicate(latestSnapshot)) return latestSnapshot;
        await sleep(25);
      }
      throw new Error(`Timed out waiting for authoritative snapshot: ${label}`);
    },
  };
}

async function sendCanonicalControl(
  socket: Socket,
  observer: AdminObserver,
  sessionId: string,
  intent: "resume" | "pause" | "seek" | "restart" | "stop" | "seek-marker" | "set-speed",
  extras: {
    cursor?: DocumentCursor;
    markerId?: string;
    velocityPointsPerSecond?: number;
  },
  timeoutMs: number
): Promise<SyncSnapshot> {
  const current = observer.latest();
  if (!current?.documentGeometry || !current.documentCursor) {
    throw new Error(`Cannot send ${intent}: canonical document geometry is unavailable.`);
  }

  const expectedControlVersion = current.controlVersion ?? 0;
  socket.emit("admin-control", {
    sessionId,
    intent,
    revision: current.documentGeometry.revision,
    expectedControlVersion,
    ...extras,
  });

  const snapshot = await observer.waitForSnapshot(
    `${intent} controlVersion ${expectedControlVersion + 1}`,
    (candidate) => (candidate.controlVersion ?? 0) === expectedControlVersion + 1,
    timeoutMs
  );

  if (snapshot.documentCursor?.revision !== snapshot.documentGeometry.revision) {
    throw new Error(`Invalid ${intent} response: cursor revision does not match document geometry.`);
  }
  return snapshot;
}

async function waitForCondition(
  label: string,
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function login(baseUrl: string, adminPassword: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: originHeaders(baseUrl, { "Content-Type": "application/json" }),
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
      headers: originHeaders(baseUrl, {
        "Content-Type": "application/json",
        Cookie: cookie,
      }),
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
): Promise<AdminSession> {
  const fileBuffer = await readFile(pdfPath);
  const form = new FormData();
  form.append(
    "pdf",
    new Blob([fileBuffer], { type: "application/pdf" }),
    basename(pdfPath)
  );

  const response = await fetch(`${baseUrl}/api/admin/sessions/${sessionId}/pdf`, {
    method: "POST",
    headers: originHeaders(baseUrl, { Cookie: cookie }),
    body: form,
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`PDF upload failed with status ${response.status}: ${body}`);
  }

  return response.json() as Promise<AdminSession>;
}

async function fetchMetrics(baseUrl: string, cookie: string): Promise<MetricsSnapshot> {
  return fetchJson<MetricsSnapshot>(`${baseUrl}/api/admin/metrics`, {
    headers: originHeaders(baseUrl, { Cookie: cookie }),
  });
}

async function verifyAdminSession(baseUrl: string, cookie: string): Promise<void> {
  const result = await fetchJson<{ isAdmin: boolean }>(`${baseUrl}/api/admin/me`, {
    headers: originHeaders(baseUrl, { Cookie: cookie }),
  });
  if (!result.isAdmin) throw new Error("Login cookie was not accepted by the target server.");
}

async function deleteSession(baseUrl: string, cookie: string, sessionId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/admin/sessions/${sessionId}`, {
    method: "DELETE",
    headers: originHeaders(baseUrl, { Cookie: cookie }),
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`Delete session failed with status ${response.status}: ${body}`);
  }
}

function connectAdminSocket(
  baseUrl: string,
  cookie: string,
  runtime: RuntimeManifest
): Promise<Socket> {
  const headers = originHeaders(baseUrl, { Cookie: cookie });
  const socket = io(baseUrl, {
    auth: runtime,
    extraHeaders: headers,
    forceNew: true,
    reconnection: false,
    // The Node CLI's administrator channel uses polling so its explicit cookie
    // follows the same HTTP path that authenticated the preceding REST calls.
    // Public viewers still use the requested WebSocket transport under load.
    transports: ["polling"],
    transportOptions: {
      polling: { extraHeaders: headers },
    },
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
  observer: AdminObserver,
  session: AdminSession,
  config: Config
): Promise<void> {
  emitAdmin(socket, "admin-join-session", session.id);
  await observer.waitForSnapshot("admin session join", (snapshot) => snapshot.id === session.id, config.verifyTimeoutMs);

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
    if (config.startPlaying) {
      emitAdmin(socket, "admin-play", session.id);
    }
    return;
  }

  if (!session.documentGeometry) {
    throw new Error("Scroll-mode load tests require --pdf-path so the server can extract document geometry.");
  }

  const speedSnapshot = await sendCanonicalControl(
    socket,
    observer,
    session.id,
    "set-speed",
    { velocityPointsPerSecond: config.speed },
    config.verifyTimeoutMs
  );
  if (speedSnapshot.scrollVelocityPointsPerSecond !== config.speed) {
    throw new Error(`Server did not apply requested document speed ${config.speed}.`);
  }

  if (config.startPlaying) {
    const playingSnapshot = await sendCanonicalControl(
      socket,
      observer,
      session.id,
      "resume",
      {},
      config.verifyTimeoutMs
    );
    if (!playingSnapshot.playing) throw new Error("Server did not resume canonical playback.");
  }
}

function connectViewer(
  baseUrl: string,
  sessionCode: string,
  transports: ("websocket" | "polling")[],
  viewerStats: ViewerStats,
  index: number,
  runtime: RuntimeManifest,
  expectedRevision?: string
): ViewerClient {
  const headers = originHeaders(baseUrl);
  const socket = io(baseUrl, {
    autoConnect: true,
    auth: runtime,
    extraHeaders: headers,
    forceNew: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
    transports,
    transportOptions: {
      websocket: { extraHeaders: headers },
      polling: { extraHeaders: headers },
    },
    withCredentials: true,
  });

  const viewer: ViewerClient = {
    index,
    joined: false,
    lastPositionSequence: 0,
    socket,
    startedAt: Date.now(),
  };

  socket.on("connect", () => {
    viewerStats.connected += 1;
    socket.emit("join-session", sessionCode);
    socket.emit("request-session-state", sessionCode);
  });

  socket.on("session-state", (snapshot: SyncSnapshot) => {
    viewerStats.sessionStates += 1;
    if (snapshot.positionSequence <= viewer.lastPositionSequence) {
      viewerStats.snapshotErrors.push(
        `viewer ${index}: non-monotonic position sequence ${snapshot.positionSequence} after ${viewer.lastPositionSequence}`
      );
    }
    viewer.lastPositionSequence = Math.max(viewer.lastPositionSequence, snapshot.positionSequence);

    if (expectedRevision && snapshot.documentGeometry?.revision !== expectedRevision) {
      viewerStats.snapshotErrors.push(`viewer ${index}: document revision mismatch`);
    }
    if (snapshot.documentCursor && snapshot.documentCursor.revision !== snapshot.documentGeometry?.revision) {
      viewerStats.snapshotErrors.push(`viewer ${index}: cursor revision mismatch`);
    }
    if (!viewer.firstCursor && snapshot.documentCursor) {
      viewer.firstCursor = snapshot.documentCursor;
    }
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

async function exerciseCanonicalControls(
  socket: Socket,
  observer: AdminObserver,
  sessionId: string,
  config: Config
): Promise<void> {
  let snapshot = await sendCanonicalControl(socket, observer, sessionId, "pause", {}, config.verifyTimeoutMs);
  if (snapshot.playing) throw new Error("Pause control did not stop canonical playback.");

  const geometry = snapshot.documentGeometry;
  if (!geometry) throw new Error("Canonical control exercise requires document geometry.");
  const seekCursor: DocumentCursor = {
    revision: geometry.revision,
    yMicroPoints: Math.max(1, Math.round(geometry.totalHeightPoints * 500)),
  };
  snapshot = await sendCanonicalControl(
    socket,
    observer,
    sessionId,
    "seek",
    { cursor: seekCursor },
    config.verifyTimeoutMs
  );
  if (snapshot.documentCursor?.yMicroPoints !== seekCursor.yMicroPoints) {
    throw new Error("Canonical seek did not return the requested PDF cursor.");
  }

  if (geometry.pageHeightsPoints.length > 1) {
    const markerId = "load-test-marker";
    socket.emit("admin-set-markers", {
      sessionId,
      markers: [{ id: markerId, title: "Load test marker", page: 2 }],
    });
    await observer.waitForSnapshot(
      "persisted marker",
      (candidate) => candidate.markers?.some((marker) => marker.id === markerId) ?? false,
      config.verifyTimeoutMs
    );
    snapshot = await sendCanonicalControl(
      socket,
      observer,
      sessionId,
      "seek-marker",
      { markerId },
      config.verifyTimeoutMs
    );
    if (!snapshot.documentCursor || snapshot.documentCursor.yMicroPoints <= 0) {
      throw new Error("Marker seek did not move to the persisted marker page.");
    }
  }

  snapshot = await sendCanonicalControl(socket, observer, sessionId, "restart", {}, config.verifyTimeoutMs);
  if (snapshot.documentCursor?.yMicroPoints !== 0 || snapshot.playing) {
    throw new Error("Restart did not pause at the beginning of the document.");
  }

  snapshot = await sendCanonicalControl(socket, observer, sessionId, "resume", {}, config.verifyTimeoutMs);
  if (!snapshot.playing) throw new Error("Resume after control exercise failed.");
}

async function reconnectViewers(
  viewers: ViewerClient[],
  requestedCount: number,
  timeoutMs: number
): Promise<void> {
  const targets = viewers.slice(0, Math.max(0, Math.min(requestedCount, viewers.length)));
  const before = new Map(targets.map((viewer) => [viewer.index, viewer.lastPositionSequence]));

  for (const viewer of targets) viewer.socket.disconnect();
  await sleep(100);
  for (const viewer of targets) viewer.socket.connect();

  await waitForCondition(
    "viewer reconnect snapshots",
    () =>
      targets.every(
        (viewer) =>
          viewer.socket.connected &&
          viewer.lastPositionSequence > (before.get(viewer.index) ?? 0)
      ),
    timeoutMs
  );
}

async function connectViewerWave(
  count: number,
  startIndex: number,
  config: Config,
  session: AdminSession,
  runtime: RuntimeManifest,
  viewerStats: ViewerStats,
  viewers: ViewerClient[],
  delayBetweenBatchesMs: number
): Promise<ViewerClient[]> {
  const wave: ViewerClient[] = [];

  for (let offset = 0; offset < count; offset += config.batchSize) {
    const batchEnd = Math.min(count, offset + config.batchSize);
    for (let batchOffset = offset; batchOffset < batchEnd; batchOffset += 1) {
      const viewer = connectViewer(
        config.baseUrl,
        session.code,
        config.transports,
        viewerStats,
        startIndex + batchOffset,
        runtime,
        session.documentGeometry?.revision
      );
      wave.push(viewer);
      viewers.push(viewer);
    }

    if (batchEnd < count && delayBetweenBatchesMs > 0) {
      await sleep(delayBetweenBatchesMs);
    }
  }

  await waitForCondition(
    `${count} viewers to join`,
    () => wave.every((viewer) => viewer.joined),
    config.verifyTimeoutMs
  );
  return wave;
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
  const runtime = await fetchJson<RuntimeManifest>(`${config.baseUrl}/api/runtime`);
  const cookie = await login(config.baseUrl, config.adminPassword);
  await verifyAdminSession(config.baseUrl, cookie);
  let session = await createSession(config.baseUrl, cookie);
  if (config.pdfPath) {
    console.log(`Uploading PDF: ${config.pdfPath}`);
    session = await uploadPdf(config.baseUrl, cookie, session.id, config.pdfPath);
  }
  const adminSocket = await connectAdminSocket(config.baseUrl, cookie, runtime);
  const adminObserver = createAdminObserver(adminSocket, session.id);
  const viewerStats: ViewerStats = {
    connected: 0,
    connectErrors: 0,
    disconnected: 0,
    joined: 0,
    sessionStates: 0,
    snapshotErrors: [],
  };
  const viewers: ViewerClient[] = [];
  const startedAt = Date.now();
  let leaseTimer: NodeJS.Timeout | null = null;
  let metricsTimer: NodeJS.Timeout | null = null;
  let pageFlipTimer: NodeJS.Timeout | null = null;

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
    if (leaseTimer) clearInterval(leaseTimer);
    if (metricsTimer) clearInterval(metricsTimer);
    if (pageFlipTimer) clearInterval(pageFlipTimer);
    adminObserver.dispose();
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

  try {
  await configureSession(adminSocket, adminObserver, session, config);
  leaseTimer = setInterval(() => {
    adminSocket.emit("admin-control-lease", session.id);
  }, 5_000);

  const initialClientCount = config.clients - config.lateJoinClients;
  await connectViewerWave(
    initialClientCount,
    0,
    config,
    session,
    runtime,
    viewerStats,
    viewers,
    initialClientCount > config.batchSize
      ? Math.max(0, config.rampMs / (Math.ceil(initialClientCount / config.batchSize) - 1))
      : 0
  );

  let cursorBeforeLateJoin: number | null = null;
  if (config.lateJoinClients > 0 && config.mode === "scroll" && config.startPlaying) {
    await adminObserver.waitForSnapshot(
      "active playback before late viewer join",
      (snapshot) => snapshot.playing && !!snapshot.documentCursor,
      config.verifyTimeoutMs
    );
  }
  if (config.lateJoinClients > 0) {
    await sleep(config.lateJoinDelayMs);
    if (config.mode === "scroll" && config.startPlaying) {
      const snapshot = adminObserver.latest();
      if (!snapshot?.playing || !snapshot.documentCursor) {
        throw new Error("Canonical playback was unavailable when the late viewer wave started.");
      }
      cursorBeforeLateJoin = snapshot.documentCursor.yMicroPoints;
    }
    const lateViewers = await connectViewerWave(
      config.lateJoinClients,
      initialClientCount,
      config,
      session,
      runtime,
      viewerStats,
      viewers,
      config.lateJoinBatchDelayMs
    );
    if (cursorBeforeLateJoin !== null) {
      for (const viewer of lateViewers) {
        if ((viewer.firstCursor?.yMicroPoints ?? -1) < cursorBeforeLateJoin) {
          throw new Error(`Late viewer ${viewer.index} did not receive the active canonical cursor.`);
        }
      }
    }
  }

  await reconnectViewers(viewers, config.reconnectClients, config.verifyTimeoutMs);
  if (config.mode === "scroll" && config.exerciseControls) {
    await exerciseCanonicalControls(adminSocket, adminObserver, session.id, config);
  }

  metricsTimer = setInterval(async () => {
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

  if (metricsTimer) clearInterval(metricsTimer);
  if (leaseTimer) clearInterval(leaseTimer);
  if (pageFlipTimer) clearInterval(pageFlipTimer);

  if (config.mode === "scroll" && config.exerciseControls) {
    const stoppedSnapshot = await sendCanonicalControl(
      adminSocket,
      adminObserver,
      session.id,
      "stop",
      {},
      config.verifyTimeoutMs
    );
    if (stoppedSnapshot.playing || stoppedSnapshot.documentCursor?.yMicroPoints !== 0) {
      throw new Error("Stop did not reset the canonical cursor to the document start.");
    }
  }

  const finalMetrics = await fetchMetrics(config.baseUrl, cookie);
  if (viewerStats.connectErrors > 0 || viewerStats.snapshotErrors.length > 0) {
    throw new Error(
      `Viewer verification failed: connectErrors=${viewerStats.connectErrors}; ${viewerStats.snapshotErrors.join("; ")}`
    );
  }
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

  } finally {
    await stop();
  }
}

void main().catch((error: unknown) => {
  console.error("Load test failed:", error);
  process.exitCode = 1;
});
