import { describe, expect, it } from "vitest";
import type { SessionState } from "@/types/session";
import {
  shouldAcceptSessionState,
  shouldSnapToSessionState,
} from "./sessionSync";

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
