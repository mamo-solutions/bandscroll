import { describe, expect, it } from "vitest";
import {
  getPageDwellMs,
  getPlaybackDisplayProgress,
  pageToDisplayProgress,
  progressToNearestPage,
} from "./playback";

describe("pageToDisplayProgress", () => {
  it("maps the first and last page to the ends of the bar", () => {
    expect(pageToDisplayProgress(1, 4)).toBe(0);
    expect(pageToDisplayProgress(4, 4)).toBe(1);
  });

  it("clamps out-of-range pages", () => {
    expect(pageToDisplayProgress(0, 4)).toBe(0);
    expect(pageToDisplayProgress(9, 4)).toBe(1);
  });
});

describe("progressToNearestPage", () => {
  it("maps progress to the nearest page number", () => {
    expect(progressToNearestPage(0, 4)).toBe(1);
    expect(progressToNearestPage(0.49, 4)).toBe(2);
    expect(progressToNearestPage(0.51, 4)).toBe(3);
    expect(progressToNearestPage(1, 4)).toBe(4);
  });
});

describe("getPageDwellMs", () => {
  it("derives dwell time from speed and page count", () => {
    expect(getPageDwellMs(0.001, 4)).toBeCloseTo(250000);
  });

  it("returns null for invalid inputs", () => {
    expect(getPageDwellMs(0, 4)).toBeNull();
    expect(getPageDwellMs(0.001, 0)).toBeNull();
  });
});

describe("getPlaybackDisplayProgress", () => {
  it("uses stored progress in scroll mode", () => {
    expect(getPlaybackDisplayProgress("scroll", 0.42, 3, 6)).toBe(0.42);
  });

  it("uses the page position in page mode", () => {
    expect(getPlaybackDisplayProgress("page", 0.42, 3, 5)).toBe(0.5);
  });
});
