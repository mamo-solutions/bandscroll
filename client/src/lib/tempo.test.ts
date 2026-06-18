import { describe, expect, it } from "vitest";
import {
  SPEED_MAX,
  SPEED_MIN,
  calculateSpeedFromBpm,
  deriveBpmFromTaps,
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
    pagesPerSong: 2,
    beatsPerSong: 256,
    numPages: 40,
  };

  it("returns 0 when any input is missing or invalid", () => {
    expect(calculateSpeedFromBpm({ ...base, pagesPerSong: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, beatsPerSong: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, numPages: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, detectedBpm: 0 })).toBe(0);
    expect(calculateSpeedFromBpm({ ...base, detectedBpm: -5 })).toBe(0);
  });

  it("computes speed = songProgress / songDurationSeconds", () => {
    // songProgress = 2/40 = 0.05
    // songDuration = 256 / (120/60) = 128s
    // speed = 0.05 / 128 = 0.000390625
    expect(calculateSpeedFromBpm(base)).toBeCloseTo(0.05 / 128, 12);
  });

  it("scales with tempo: faster BPM -> faster scroll", () => {
    const slow = calculateSpeedFromBpm({ ...base, detectedBpm: 60 });
    const fast = calculateSpeedFromBpm({ ...base, detectedBpm: 120 });
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeCloseTo(slow * 2, 12);
  });

  it("caps songProgress at a full document (1.0)", () => {
    // pagesPerSong > numPages should not push songProgress above 1.
    const capped = calculateSpeedFromBpm({
      ...base,
      pagesPerSong: 100,
      numPages: 40,
    });
    const full = calculateSpeedFromBpm({
      ...base,
      pagesPerSong: 40,
      numPages: 40,
    });
    expect(capped).toBe(full);
  });

  it("clamps the result to SPEED_MAX for very fast tempos", () => {
    const speed = calculateSpeedFromBpm({
      detectedBpm: 1000,
      pagesPerSong: 40,
      beatsPerSong: 128,
      numPages: 40,
    });
    expect(speed).toBe(SPEED_MAX);
  });

  it("clamps the result to SPEED_MIN for very slow scrolling", () => {
    const speed = calculateSpeedFromBpm({
      detectedBpm: 30,
      pagesPerSong: 1,
      beatsPerSong: 384,
      numPages: 1000,
    });
    expect(speed).toBe(SPEED_MIN);
  });
});
