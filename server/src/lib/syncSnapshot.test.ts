import { describe, expect, it } from "vitest";
import { createSyncSnapshot } from "./syncSnapshot.js";
import type { SessionState } from "../types.js";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-1",
    code: "SESSION-1234",
    title: "Test session",
    pdfUrl: "/uploads/test.pdf",
    status: "live",
    playing: false,
    progress: 0,
    speed: 0.001,
    updatedAt: 1_000,
    connectedClients: 0,
    createdAt: 500,
    markers: [],
    locked: false,
    playbackMode: "page",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 2,
    numPages: 3,
    stateVersion: 1,
    documentGeometry: {
      revision: "revision-1",
      pageHeightsPoints: [100, 100, 100],
      totalHeightPoints: 300,
    },
    documentCursor: { revision: "revision-1", yMicroPoints: 0 },
    positionUpdatedAt: 1_000,
    controlVersion: 1,
    ...overrides,
  };
}

describe("createSyncSnapshot", () => {
  it("preserves the selected page in page mode when the scroll cursor is on another page", () => {
    const snapshot = createSyncSnapshot(makeSession(), 4, 2_000);

    expect(snapshot.currentPage).toBe(2);
    expect(snapshot.positionSequence).toBe(4);
    expect(snapshot.serverTimestamp).toBe(2_000);
  });
});
