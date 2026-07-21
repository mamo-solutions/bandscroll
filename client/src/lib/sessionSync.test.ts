import { describe, expect, it } from "vitest";
import type { SessionState } from "@/types/session";
import {
  shouldRefreshPlaybackOffset,
  shouldAcceptSessionState,
  shouldAcceptSyncSnapshot,
  shouldSnapToScrollAnchor,
  shouldSnapToSessionState,
} from "./sessionSync";
import type { SyncSnapshot } from "@/types/session";

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "id",
    code: "SESSION-1234",
    title: "Session",
    pdfUrl: "/uploads/test.pdf",
    status: "live",
    playing: true,
    progress: 0.2,
    speed: 0.001,
    updatedAt: 0,
    connectedClients: 0,
    createdAt: 0,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 4,
    stateVersion: 1,
    ...overrides,
  };
}

describe("shouldAcceptSessionState", () => {
  it("accepts only newer authoritative snapshots", () => {
    expect(shouldAcceptSessionState(1, makeState({ stateVersion: 2 }))).toBe(true);
    expect(shouldAcceptSessionState(1, makeState({ stateVersion: 1 }))).toBe(false);
    expect(shouldAcceptSessionState(1, makeState({ stateVersion: 0 }))).toBe(false);
  });

  it("allows an equal version only for the awaited first socket snapshot", () => {
    expect(shouldAcceptSessionState(1, makeState({ stateVersion: 1 }), true)).toBe(true);
  });
});

describe("shouldAcceptSyncSnapshot", () => {
  const snapshot = (overrides: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
    ...makeState(),
    positionSequence: 10,
    serverTimestamp: 1_000,
    ...overrides,
  });

  it("accepts an ephemeral playback correction with an unchanged state version", () => {
    expect(shouldAcceptSyncSnapshot(1, 10, snapshot({ positionSequence: 11 }))).toBe(true);
  });

  it("rejects duplicate and stale playback sequences", () => {
    expect(shouldAcceptSyncSnapshot(1, 10, snapshot({ positionSequence: 10 }))).toBe(false);
    expect(shouldAcceptSyncSnapshot(1, 10, snapshot({ positionSequence: 9 }))).toBe(false);
  });

  it("continues to reject an older persisted state even when its sequence is higher", () => {
    expect(
      shouldAcceptSyncSnapshot(2, 10, snapshot({ stateVersion: 1, positionSequence: 11 }))
    ).toBe(false);
  });

  it("accepts the first awaited snapshot after a server sequence reset", () => {
    expect(shouldAcceptSyncSnapshot(1, 10, snapshot({ positionSequence: 1 }), true)).toBe(true);
  });
});

describe("shouldSnapToSessionState", () => {
  it("snaps on first state", () => {
    expect(shouldSnapToSessionState(null, makeState(), 0)).toBe(true);
  });

  it("snaps when playback intent changes", () => {
    const previous = makeState({ playbackMode: "scroll", playing: true, currentPage: 1 });
    expect(
      shouldSnapToSessionState(previous, makeState({ stateVersion: 2, playing: false }), 0.2)
    ).toBe(true);
    expect(
      shouldSnapToSessionState(
        previous,
        makeState({ stateVersion: 2, playbackMode: "page", currentPage: 2 }),
        0.2
      )
    ).toBe(true);
  });

  it("keeps easing for small scroll corrections", () => {
    const previous = makeState();
    expect(
      shouldSnapToSessionState(previous, makeState({ stateVersion: 2, progress: 0.22 }), 0.21)
    ).toBe(false);
  });
});

describe("shouldSnapToScrollAnchor", () => {
  it("snaps to the anchor on first state", () => {
    expect(
      shouldSnapToScrollAnchor(
        null,
        makeState({ scrollAnchor: { page: 2, fraction: 0.4 } }),
        true,
        0.35,
        0
      )
    ).toBe(true);
  });

  it("snaps to the anchor when playback pauses even if the anchor was already staged", () => {
    const previous = makeState({ playing: true, scrollAnchor: { page: 2, fraction: 0.4 } });

    expect(
      shouldSnapToScrollAnchor(
        previous,
        makeState({
          stateVersion: 2,
          playing: false,
          scrollAnchor: { page: 2, fraction: 0.4 },
        }),
        false,
        0.35,
        0.2
      )
    ).toBe(true);
  });

  it("keeps playing updates on the smooth progress trajectory", () => {
    const previous = makeState({ playing: true, scrollAnchor: { page: 2, fraction: 0.4 } });

    expect(
      shouldSnapToScrollAnchor(
        previous,
        makeState({
          stateVersion: 2,
          playing: true,
          scrollAnchor: { page: 2, fraction: 0.6 },
        }),
        true,
        0.45,
        0.2
      )
    ).toBe(false);
  });

  it("re-snaps a paused viewer when its displayed position drifted away from the anchor", () => {
    const previous = makeState({ playing: false, scrollAnchor: { page: 2, fraction: 0.4 } });

    expect(
      shouldSnapToScrollAnchor(
        previous,
        makeState({
          stateVersion: 2,
          playing: false,
          scrollAnchor: { page: 2, fraction: 0.4 },
        }),
        false,
        0.35,
        0.2
      )
    ).toBe(true);
  });
});

describe("shouldRefreshPlaybackOffset", () => {
  it("calibrates the playback trajectory on the first playing anchor", () => {
    expect(
      shouldRefreshPlaybackOffset(
        null,
        makeState({ scrollAnchor: { page: 2, fraction: 0.4 }, playing: true }),
        true
      )
    ).toBe(true);
  });

  it("does not recalibrate a steady playing update without a new anchor event", () => {
    const previous = makeState({ playing: true, scrollAnchor: { page: 2, fraction: 0.4 } });

    expect(
      shouldRefreshPlaybackOffset(
        previous,
        makeState({
          stateVersion: 2,
          playing: true,
          scrollAnchor: { page: 2, fraction: 0.4 },
        }),
        false
      )
    ).toBe(false);
  });

  it("recalibrates when an explicit playing reposition provides a new anchor", () => {
    const previous = makeState({ playing: true, scrollAnchor: { page: 2, fraction: 0.4 } });

    expect(
      shouldRefreshPlaybackOffset(
        previous,
        makeState({
          stateVersion: 2,
          playing: true,
          scrollAnchor: { page: 2, fraction: 0.6 },
        }),
        true
      )
    ).toBe(true);
  });
});
