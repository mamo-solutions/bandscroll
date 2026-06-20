import { listAdminSessions } from "../sessionStore.js";

// In-memory performance-metrics registry (module singleton, like the session
// store). Counters accumulate over process lifetime; per-second rates are
// computed as the delta since the previous snapshot() so they reflect recent
// load rather than a lifetime average.

let httpRequests = 0;
let httpErrors5xx = 0;
let latencySum = 0;
let latencyCount = 0;
let latencyMax = 0;

let activeSockets = 0;
let socketEventsTotal = 0;
let requestSessionStateEvents = 0;
let sessionStateBroadcasts = 0;

// Previous-snapshot markers for rate computation.
let lastSnapshotAt = Date.now();
let lastHttpRequests = 0;
let lastSocketEvents = 0;
let lastRequestSessionStateEvents = 0;

export const metrics = {
  recordRequest(durationMs: number, status: number): void {
    httpRequests++;
    latencySum += durationMs;
    latencyCount++;
    if (durationMs > latencyMax) latencyMax = durationMs;
    if (status >= 500) httpErrors5xx++;
  },

  recordSocketEvent(name: string): void {
    socketEventsTotal++;
    if (name === "request-session-state") requestSessionStateEvents++;
  },

  recordSessionStateBroadcast(): void {
    sessionStateBroadcasts++;
  },

  incSocket(): number {
    activeSockets++;
    return activeSockets;
  },

  decSocket(): number {
    activeSockets = Math.max(0, activeSockets - 1);
    return activeSockets;
  },

  /** Current process + app stats. Resets the rate window. */
  snapshot() {
    const now = Date.now();
    const elapsedSec = Math.max(0.001, (now - lastSnapshotAt) / 1000);
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

    const sessions = listAdminSessions();
    const connectedClients = sessions.reduce(
      (sum, s) => sum + s.connectedClients,
      0
    );
    const activeLiveSessions = sessions.filter((session) => session.status === "live").length;

    const round = (n: number) => Math.round(n * 100) / 100;
    const snap = {
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rssMb: mb(mem.rss),
        heapUsedMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
      },
      activeSockets,
      totalSessions: sessions.length,
      connectedClients,
      http: {
        totalRequests: httpRequests,
        errors5xx: httpErrors5xx,
        avgLatencyMs: latencyCount ? round(latencySum / latencyCount) : 0,
        maxLatencyMs: round(latencyMax),
        requestsPerSec: round((httpRequests - lastHttpRequests) / elapsedSec),
      },
      socket: {
        totalEvents: socketEventsTotal,
        eventsPerSec: round((socketEventsTotal - lastSocketEvents) / elapsedSec),
        requestSessionStateEvents,
        requestSessionStatePerSec: round(
          (requestSessionStateEvents - lastRequestSessionStateEvents) / elapsedSec
        ),
        sessionStateBroadcasts,
      },
      playback: {
        activeLiveSessions,
      },
    };

    lastSnapshotAt = now;
    lastHttpRequests = httpRequests;
    lastSocketEvents = socketEventsTotal;
    lastRequestSessionStateEvents = requestSessionStateEvents;
    return snap;
  },

  /** Test helper: reset all counters and the rate window. */
  reset(): void {
    httpRequests = httpErrors5xx = latencySum = latencyCount = latencyMax = 0;
    activeSockets = socketEventsTotal = requestSessionStateEvents = sessionStateBroadcasts = 0;
    lastSnapshotAt = Date.now();
    lastHttpRequests = lastSocketEvents = 0;
    lastRequestSessionStateEvents = 0;
  },
};

export type MetricsSnapshot = ReturnType<typeof metrics.snapshot>;
