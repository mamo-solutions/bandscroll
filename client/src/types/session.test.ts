import { afterEach, describe, expect, it, vi } from "vitest";
import { clamp01, effectiveProgress, type SessionState } from "./session";

function makeState(over: Partial<SessionState> = {}): SessionState {
  return {
    id: "id",
    code: "SESSION-1234",
    title: "t",
    pdfUrl: "/uploads/x.pdf",
    status: "live",
    playing: false,
    progress: 0,
    speed: 0.001,
    updatedAt: 0,
    connectedClients: 0,
    createdAt: 0,
    markers: [],
    ...over,
  };
}

afterEach(() => vi.useRealTimers());

describe("clamp01", () => {
  it.each([
    [0, 0],
    [1, 1],
    [0.25, 0.25],
    [-5, 0],
    [9, 1],
    [NaN, 0],
  ])("clamps %s -> %s", (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });
});

describe("effectiveProgress", () => {
  it("returns the stored progress (clamped) when paused", () => {
    expect(effectiveProgress(makeState({ playing: false, progress: 0.3 }), 10_000)).toBe(0.3);
    // ignores elapsed time entirely while paused
    expect(effectiveProgress(makeState({ playing: false, progress: 1.5 }), 10_000)).toBe(1);
  });

  it("extrapolates forward while playing based on elapsed time and speed", () => {
    const state = makeState({ playing: true, progress: 0, speed: 0.001, updatedAt: 1_000 });
    // 10s elapsed * 0.001 = 0.01
    expect(effectiveProgress(state, 11_000)).toBeCloseTo(0.01, 10);
    // 250s elapsed * 0.001 = 0.25, plus starting 0
    expect(effectiveProgress(state, 251_000)).toBeCloseTo(0.25, 10);
  });

  it("starts from the current progress offset", () => {
    const state = makeState({ playing: true, progress: 0.5, speed: 0.002, updatedAt: 0 });
    // 100s * 0.002 = 0.2 -> 0.7
    expect(effectiveProgress(state, 100_000)).toBeCloseTo(0.7, 10);
  });

  it("clamps at 1.0 (stops at the end) and never exceeds it", () => {
    const state = makeState({ playing: true, progress: 0.9, speed: 0.01, updatedAt: 0 });
    // would be 0.9 + 100*0.01 = 1.9 -> clamp to 1
    expect(effectiveProgress(state, 100_000)).toBe(1);
  });

  it("never goes below 0 with a negative speed", () => {
    const state = makeState({ playing: true, progress: 0.1, speed: -0.01, updatedAt: 0 });
    expect(effectiveProgress(state, 100_000)).toBe(0);
  });

  it("defaults the clock to Date.now()", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const state = makeState({ playing: true, progress: 0, speed: 0.001, updatedAt: 0 });
    // 2s elapsed * 0.001 = 0.002
    expect(effectiveProgress(state)).toBeCloseTo(0.002, 10);
  });
});
