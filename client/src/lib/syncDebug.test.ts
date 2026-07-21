import { beforeEach, describe, expect, it } from "vitest";
import type { SessionState } from "@/types/session";
import { driftSeverity, formatDebugNumber, getSyncDebugSnapshot, httpLatencySeverity, isSyncDebugEnabled, recordDebugPing, recordSocketDebugEvent, recordSyncSnapshot, resetSyncDebugForTests, rttSeverity, snapshotAgeSeverity, snapshotIntervalSeverity } from "./syncDebug";

const state: SessionState & { positionSequence: number } = {
  id: "id", code: "TEST", title: "Test", pdfUrl: "", status: "live", playing: true, progress: 0, speed: 0, updatedAt: 0, connectedClients: 1, createdAt: 0, markers: [], locked: false, playbackMode: "scroll", backgroundMode: "light", autoStopAtSongEnd: false, currentPage: 2, numPages: 2, stateVersion: 5, controlVersion: 3, positionSequence: 7,
  documentGeometry: { revision: "rev", pageHeightsPoints: [100, 100], totalHeightPoints: 200 }, documentCursor: { revision: "rev", yMicroPoints: 50_000 }, scrollVelocityPointsPerSecond: 24,
};

beforeEach(resetSyncDebugForTests);

describe("sync debug telemetry", () => {
  it("formats unavailable and numeric values", () => {
    expect(formatDebugNumber(null)).toBe("—");
    expect(formatDebugNumber(12.345, 1)).toBe("12.3");
    expect(isSyncDebugEnabled("?debug=1")).toBe(true);
    expect(isSyncDebugEnabled("")).toBe(false);
  });

  it("records socket, RTT, cursor, and derived position diagnostics", () => {
    recordSocketDebugEvent({ connected: true, transport: "websocket", reconnectAttempts: 2 });
    recordDebugPing(12.6);
    recordSyncSnapshot(state, 2_500, "bounded");
    expect(getSyncDebugSnapshot()).toMatchObject({ connected: true, transport: "websocket", reconnectAttempts: 2, rttMs: 13, positionSequence: 7, correction: "bounded", cursorPoints: 50, documentPercent: 25, driftPoints: 2.5, currentPage: 2, velocityPointsPerSecond: 24 });
  });

  it("classifies only meaningful live-sync delays as warnings or failures", () => {
    expect(rttSeverity(150)).toBe("normal");
    expect(rttSeverity(200)).toBe("warning");
    expect(rttSeverity(500)).toBe("danger");
    expect(snapshotAgeSeverity(2_000, true)).toBe("warning");
    expect(snapshotAgeSeverity(4_000, true)).toBe("danger");
    expect(snapshotAgeSeverity(10_000, false)).toBe("normal");
    expect(snapshotIntervalSeverity(1_001, true)).toBe("warning");
    expect(driftSeverity(25, "bounded")).toBe("warning");
    expect(driftSeverity(200, "snap")).toBe("normal");
    expect(httpLatencySeverity(1_000)).toBe("danger");
  });
});
