import { describe, expect, it } from "vitest";
import { createDocumentGeometry } from "./documentPosition.js";
import { applyCanonicalControl } from "./sessionControl.js";
import type { SessionState } from "../types.js";

const geometry = createDocumentGeometry("revision-a", [100, 250, 50]);

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-id",
    code: "SESSION-1000",
    title: "Canonical controls",
    pdfUrl: "/uploads/document.pdf",
    status: "live",
    playing: false,
    progress: 0,
    speed: 0,
    updatedAt: 1_000,
    connectedClients: 0,
    createdAt: 1_000,
    markers: [{ id: "song-two", title: "Song two", page: 2 }],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 3,
    stateVersion: 9,
    documentGeometry: geometry,
    documentCursor: { revision: geometry.revision, yMicroPoints: 25_000 },
    scrollVelocityPointsPerSecond: 40,
    positionUpdatedAt: 1_000,
    controlVersion: 4,
    ...overrides,
  };
}

describe("canonical conductor controls", () => {
  it("materializes a playing cursor at receipt time before pausing", () => {
    const result = applyCanonicalControl(session({ playing: true }), {
      intent: "pause",
      revision: geometry.revision,
      expectedControlVersion: 4,
    }, 1_500);

    expect(result).toEqual({
      patch: expect.objectContaining({
        documentCursor: { revision: geometry.revision, yMicroPoints: 45_000 },
        playing: false,
        positionUpdatedAt: 1_500,
        controlVersion: 5,
      }),
    });
  });

  it("does not let playback state versions invalidate a discrete command", () => {
    const result = applyCanonicalControl(session({ stateVersion: 1_000, playing: true }), {
      intent: "resume",
      revision: geometry.revision,
      expectedControlVersion: 4,
    }, 1_250);

    expect(result).toEqual({
      patch: expect.objectContaining({ playing: true, controlVersion: 5 }),
    });
  });

  it("persists a conductor-derived auto-stop cursor when resuming", () => {
    const result = applyCanonicalControl(session(), {
      intent: "resume",
      revision: geometry.revision,
      expectedControlVersion: 4,
      autoStopCursor: { revision: geometry.revision, yMicroPoints: 275_000 },
    });

    expect(result).toEqual({
      patch: expect.objectContaining({
        autoStopCursor: { revision: geometry.revision, yMicroPoints: 275_000 },
        playing: true,
        controlVersion: 5,
      }),
    });
  });

  it("clears a prior auto-stop cursor when resume has no valid target", () => {
    const withTarget = session({
      autoStopCursor: { revision: geometry.revision, yMicroPoints: 275_000 },
    });

    const explicitClear = applyCanonicalControl(withTarget, {
      intent: "resume",
      revision: geometry.revision,
      expectedControlVersion: 4,
      autoStopCursor: null,
    });
    expect(explicitClear).toEqual({ patch: expect.objectContaining({ autoStopCursor: null }) });

    const invalidTarget = applyCanonicalControl(withTarget, {
      intent: "resume",
      revision: geometry.revision,
      expectedControlVersion: 4,
      autoStopCursor: { revision: "different-revision", yMicroPoints: 275_000 },
    });
    expect(invalidTarget).toEqual({ patch: expect.objectContaining({ autoStopCursor: null }) });
  });

  it("resolves a persisted marker to its intrinsic page start", () => {
    const result = applyCanonicalControl(session(), {
      intent: "seek-marker",
      revision: geometry.revision,
      expectedControlVersion: 4,
      markerId: "song-two",
    });

    expect(result).toEqual({
      patch: expect.objectContaining({
        documentCursor: { revision: geometry.revision, yMicroPoints: 100_000 },
        currentPage: 2,
        playing: false,
        controlVersion: 5,
      }),
    });
  });

  it("restores a marker's canonical PDF-point tempo atomically", () => {
    const result = applyCanonicalControl(session({
      markers: [{ id: "song-two", title: "Song two", page: 2, scrollVelocityPointsPerSecond: 36 }],
    }), {
      intent: "seek-marker",
      revision: geometry.revision,
      expectedControlVersion: 4,
      markerId: "song-two",
    });

    expect(result).toEqual({
      patch: expect.objectContaining({ scrollVelocityPointsPerSecond: 36 }),
    });
  });

  it("seeks to an explicit cursor on an unequal-height page without progress", () => {
    const result = applyCanonicalControl(session(), {
      intent: "seek",
      revision: geometry.revision,
      expectedControlVersion: 4,
      cursor: { revision: geometry.revision, yMicroPoints: 325_000 },
    });

    expect(result).toEqual({
      patch: expect.objectContaining({
        documentCursor: { revision: geometry.revision, yMicroPoints: 325_000 },
        currentPage: 2,
        playing: false,
      }),
    });
  });

  it("rejects stale control, document, and marker commands without a patch", () => {
    expect(applyCanonicalControl(session(), {
      intent: "restart",
      revision: geometry.revision,
      expectedControlVersion: 3,
    })).toEqual({ error: "control-version-stale" });
    expect(applyCanonicalControl(session(), {
      intent: "restart",
      revision: "old-document",
      expectedControlVersion: 4,
    })).toEqual({ error: "document-revision-mismatch" });
    expect(applyCanonicalControl(session(), {
      intent: "seek-marker",
      revision: geometry.revision,
      expectedControlVersion: 4,
      markerId: "missing",
    })).toEqual({ error: "marker-not-found" });
  });

  it("uses exact canonical zero for restart and stop", () => {
    const restart = applyCanonicalControl(session(), {
      intent: "restart",
      revision: geometry.revision,
      expectedControlVersion: 4,
    });
    const stop = applyCanonicalControl(session(), {
      intent: "stop",
      revision: geometry.revision,
      expectedControlVersion: 4,
    });

    expect(restart).toEqual({ patch: expect.objectContaining({
      documentCursor: { revision: geometry.revision, yMicroPoints: 0 },
      playing: false,
    }) });
    expect(stop).toEqual({ patch: expect.objectContaining({
      documentCursor: { revision: geometry.revision, yMicroPoints: 0 },
      status: "draft",
      playing: false,
    }) });
  });
});
