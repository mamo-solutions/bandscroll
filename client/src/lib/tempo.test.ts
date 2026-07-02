import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCROLL_SCREENS_PER_MINUTE,
  SPEED_MAX,
  SPEED_MIN,
  calculateSpeedFromBpm,
  deriveBpmFromTaps,
  screensPerMinuteToSpeed,
  speedToScreensPerMinute,
  speedToSecondsPerScreen,
} from "./tempo";

describe("deriveBpmFromTaps", () => {
  it("returns null with fewer than two taps", () => {
    expect(deriveBpmFromTaps([])).toBeNull();
    expect(deriveBpmFromTaps([1000])).toBeNull();
  });

  it("derives 120 BPM from taps 500ms apart", () => {
    // 500ms interval -> 60000/500 = 120 BPM
    expect(deriveBpmFromTaps([0, 500, 1000, 1500])).toBe(120);
  });

  it("derives 60 BPM from taps 1000ms apart", () => {
    expect(deriveBpmFromTaps([0, 1000, 2000])).toBe(60);
  });

  it("averages uneven intervals", () => {
    // intervals 400, 600 -> avg 500 -> 120 BPM
    expect(deriveBpmFromTaps([0, 400, 1000])).toBe(120);
  });

  it("rounds to the nearest whole BPM", () => {
    // interval 333ms -> 60000/333 = 180.18 -> 180
    expect(deriveBpmFromTaps([0, 333])).toBe(180);
  });

  it("returns null when timestamps do not advance", () => {
    expect(deriveBpmFromTaps([1000, 1000, 1000])).toBeNull();
  });
});

describe("calculateSpeedFromBpm", () => {
  const base = {
    detectedBpm: 120,
    screensPerSong: 3,
    beatsPerSong: 256,
    scrollableScreens: 12,
  };

  it("returns 0 when any input is missing or invalid", () => {
    expect(calculateSpeedFromBpm({ ...base, screensPerSong: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, beatsPerSong: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, scrollableScreens: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, detectedBpm: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, detectedBpm: -5 })).toBe(0);
  });

  it("computes speed from screens per song and visible song duration", () => {
    // songDuration = 256 / (120/60) = 128s
    // screensPerSecond = 3 / 128
    // speed = (3 / 128) / 12 = 0.001953125
    expect(calculateSpeedFromBpm(base)).toBeCloseTo((3 / 128) / 12, 12);
  });

  it("scales with tempo: faster BPM -> faster scroll", () => {
    const slow = calculateSpeedFromBpm({ ...base, detectedBpm: 60 });
    const fast = calculateSpeedFromBpm({ ...base, detectedBpm: 120 });
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeCloseTo(slow * 2, 12);
  });

  it("does not depend on page count, only visible distance", () => {
    const shortScore = calculateSpeedFromBpm({
      ...base,
      screensPerSong: 2.5,
      scrollableScreens: 8,
    });
    const longScore = calculateSpeedFromBpm({
      ...base,
      screensPerSong: 2.5,
      scrollableScreens: 8,
    });
    expect(shortScore).toBeCloseTo(longScore, 12);
  });

  it("clamps the result to SPEED_MAX for very fast tempos", () => {
    const speed = calculateSpeedFromBpm({
      detectedBpm: 1000,
      screensPerSong: 30,
      beatsPerSong: 128,
      scrollableScreens: 6,
    });
    expect(speed).toBe(SPEED_MAX);
  });

  it("clamps the result to SPEED_MIN for very slow scrolling", () => {
    const speed = calculateSpeedFromBpm({
      detectedBpm: 30,
      screensPerSong: 1,
      beatsPerSong: 384,
      scrollableScreens: 200,
    });
    expect(speed).toBe(SPEED_MIN);
  });
});

describe("screen tempo conversion helpers", () => {
  it("round-trips screens per minute through raw speed", () => {
    const rawSpeed = screensPerMinuteToSpeed(DEFAULT_SCROLL_SCREENS_PER_MINUTE, 14);
    expect(speedToScreensPerMinute(rawSpeed, 14)).toBeCloseTo(
      DEFAULT_SCROLL_SCREENS_PER_MINUTE,
      10
    );
  });

  it("derives seconds per screen from raw speed", () => {
    const rawSpeed = screensPerMinuteToSpeed(6, 10);
    expect(speedToSecondsPerScreen(rawSpeed, 10)).toBeCloseTo(10, 10);
  });
});
