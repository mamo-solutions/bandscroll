import { describe, expect, it } from "vitest";
import {
  getEffectivePageHeights,
  getPageTopOffsets,
  getReservedPageHeights,
  getSinglePageWidth,
  getVisiblePageRange,
} from "./pdfViewerLayout";

describe("getReservedPageHeights", () => {
  it("preserves mixed page heights instead of assuming the first page ratio", () => {
    expect(getReservedPageHeights(100, [1.4, 4.2, 1.4])).toEqual([140, 420, 140]);
  });
});

describe("getPageTopOffsets", () => {
  it("builds cumulative offsets for mixed-height pages", () => {
    expect(getPageTopOffsets([140, 420, 140], 12, 12)).toEqual([12, 164, 596]);
  });
});

describe("getEffectivePageHeights", () => {
  it("prefers measured heights over predicted placeholders", () => {
    expect(getEffectivePageHeights([140, 420, 140], [undefined, 440, null])).toEqual([
      140,
      440,
      140,
    ]);
  });
});

describe("getVisiblePageRange", () => {
  it("keeps a tall middle page visible when the viewport sits inside it", () => {
    expect(
      getVisiblePageRange(300, 120, [12, 164, 596], [140, 420, 140], 0)
    ).toEqual({ start: 1, end: 1 });
  });

  it("applies overscan around the tall visible page", () => {
    expect(
      getVisiblePageRange(300, 120, [12, 164, 596], [140, 420, 140], 1)
    ).toEqual({ start: 0, end: 2 });
  });
});

describe("getSinglePageWidth", () => {
  it("fits each page using its own aspect ratio", () => {
    expect(getSinglePageWidth(800, 600, 3, true)).toBe(280);
    expect(getSinglePageWidth(800, 600, 0.5, true)).toBe(800);
  });
});
