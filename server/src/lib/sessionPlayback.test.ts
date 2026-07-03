import { describe, expect, it } from "vitest";
import type { SessionState } from "../types.js";
import { nextPlaybackPatch, nextSongStartPage } from "./sessionPlayback.js";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "id",
    code: "SESSION-1234",
    title: "Session",
    pdfUrl: "/uploads/test.pdf",
    status: "live",
    playing: true,
    progress: 0,
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
    stateVersion: 0,
    ...overrides,
  };
}

describe("nextPlaybackPatch", () => {
  it("advances scroll playback from server time", () => {
    const patch = nextPlaybackPatch(makeSession({ progress: 0.2, speed: 0.001 }), 10_000);
    expect(patch?.currentPage).toBe(1);
    expect(patch?.playing).toBe(true);
    expect(patch?.progress).toBeCloseTo(0.21, 10);
  });

  it("stops scroll playback at the end", () => {
    const patch = nextPlaybackPatch(makeSession({ progress: 0.99, speed: 0.01 }), 2_000);
    expect(patch).toEqual({
      progress: 1,
      currentPage: 1,
      playing: false,
    });
  });

  it("keeps page mode alive even without local admin timers", () => {
    const patch = nextPlaybackPatch(
      makeSession({
        playbackMode: "page",
        progress: 0.24,
        currentPage: 1,
        speed: 0.001,
        numPages: 4,
      }),
      20_000
    );
    expect(patch).toEqual({
      progress: 0.26,
      currentPage: 2,
      playing: true,
    });
  });

  it("holds page mode steady until page metadata is known", () => {
    const patch = nextPlaybackPatch(
      makeSession({
        playbackMode: "page",
        progress: 0,
        currentPage: 1,
        speed: 0.001,
        numPages: 0,
      }),
      5_000
    );
    expect(patch).toBeNull();
  });

  it("stops page mode when the last page is reached", () => {
    const patch = nextPlaybackPatch(
      makeSession({
        playbackMode: "page",
        progress: 0.74,
        currentPage: 3,
        speed: 0.001,
        numPages: 4,
      }),
      20_000
    );
    expect(patch).toEqual({
      progress: 0.75,
      currentPage: 4,
      playing: false,
    });
  });

  it("auto-stops page mode on the next song's first page when enabled", () => {
    const patch = nextPlaybackPatch(
      makeSession({
        playbackMode: "page",
        autoStopAtSongEnd: true,
        markers: [{ id: "m", title: "Song 2", page: 3 }],
        progress: 0.48,
        currentPage: 2,
        speed: 0.001,
        numPages: 4,
      }),
      20_000
    );
    expect(patch).toEqual({
      progress: 0.5, // pageStartProgress(3, 4)
      currentPage: 3,
      playing: false,
    });
  });

  it("does not auto-stop page mode when the flag is off", () => {
    const patch = nextPlaybackPatch(
      makeSession({
        playbackMode: "page",
        autoStopAtSongEnd: false,
        markers: [{ id: "m", title: "Song 2", page: 3 }],
        progress: 0.48,
        currentPage: 2,
        speed: 0.001,
        numPages: 4,
      }),
      20_000
    );
    expect(patch).toEqual({
      progress: 0.5,
      currentPage: 3,
      playing: true,
    });
  });
});

describe("nextSongStartPage", () => {
  const markers = [
    { id: "a", title: "One", page: 1 },
    { id: "b", title: "Two", page: 3 },
    { id: "c", title: "Three", page: 6 },
  ];

  it("returns the lowest marker page strictly after the current page", () => {
    expect(nextSongStartPage(markers, 1)).toBe(3);
    expect(nextSongStartPage(markers, 2)).toBe(3);
    expect(nextSongStartPage(markers, 3)).toBe(6);
  });

  it("returns null when no song starts after the current page", () => {
    expect(nextSongStartPage(markers, 6)).toBeNull();
    expect(nextSongStartPage([], 1)).toBeNull();
  });
});
