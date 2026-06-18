import { beforeEach, describe, expect, it } from "vitest";
import { metrics } from "./metrics.js";
import { createSession } from "../sessionStore.js";

beforeEach(() => {
  metrics.reset();
});

describe("metrics.recordRequest", () => {
  it("accumulates count, average, and max latency", () => {
    metrics.recordRequest(10, 200);
    metrics.recordRequest(30, 200);
    const snap = metrics.snapshot();
    expect(snap.http.totalRequests).toBe(2);
    expect(snap.http.avgLatencyMs).toBe(20);
    expect(snap.http.maxLatencyMs).toBe(30);
  });

  it("counts only 5xx responses as errors", () => {
    metrics.recordRequest(1, 200);
    metrics.recordRequest(1, 404);
    metrics.recordRequest(1, 500);
    metrics.recordRequest(1, 503);
    expect(metrics.snapshot().http.errors5xx).toBe(2);
  });
});

describe("metrics socket counters", () => {
  it("tracks the active-socket gauge and never goes negative", () => {
    metrics.incSocket();
    metrics.incSocket();
    expect(metrics.decSocket()).toBe(1);
    metrics.decSocket();
    expect(metrics.decSocket()).toBe(0); // clamped
    expect(metrics.snapshot().activeSockets).toBe(0);
  });

  it("counts admin-sync into both total and the dedicated counter", () => {
    metrics.recordSocketEvent("admin-play");
    metrics.recordSocketEvent("admin-sync");
    metrics.recordSocketEvent("admin-sync");
    const snap = metrics.snapshot();
    expect(snap.socket.totalEvents).toBe(3);
    expect(snap.socket.adminSyncEvents).toBe(2);
  });
});

describe("metrics.snapshot", () => {
  it("reports memory and uptime", () => {
    const snap = metrics.snapshot();
    expect(snap.memory.rssMb).toBeGreaterThan(0);
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("reflects sessions from the store", () => {
    const before = metrics.snapshot().totalSessions;
    createSession({ title: "Metrics test" });
    expect(metrics.snapshot().totalSessions).toBe(before + 1);
  });

  it("computes positive rates after activity between snapshots", async () => {
    metrics.snapshot(); // establish the rate window
    metrics.recordRequest(5, 200);
    metrics.recordSocketEvent("admin-sync");
    await new Promise((r) => setTimeout(r, 10));
    const snap = metrics.snapshot();
    expect(snap.http.requestsPerSec).toBeGreaterThan(0);
    expect(snap.socket.adminSyncPerSec).toBeGreaterThan(0);
  });
});
