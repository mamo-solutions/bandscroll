import { describe, expect, it } from "vitest";
import {
  anchorToScrollTop,
  getEffectivePageHeights,
  getPageTopOffsets,
  getReservedPageHeights,
  getSinglePageWidth,
  getVisiblePageRange,
  scrollTopToAnchor,
} from "./pdfViewerLayout";

describe("scroll anchors", () => {
  it("round-trips a document position independently of viewport size", () => {
    const tops = [12, 164, 596];
    const heights = [140, 420, 140];
    const anchor = scrollTopToAnchor(374, tops, heights);

    expect(anchor).toEqual({ page: 2, fraction: 0.5 });
    expect(anchorToScrollTop(anchor!, tops, heights, 700)).toBe(374);
  });

  it("clamps anchors at the available document scroll range", () => {
    expect(anchorToScrollTop({ page: 3, fraction: 1 }, [12, 164, 596], [140, 420, 140], 650)).toBe(650);
  });

  it("reaches the final page top when trailing viewport space is reserved", () => {
    const pageTops = [12, 164, 596];
    const pageHeights = [140, 420, 140];
    const viewportHeight = 300;
    const documentHeight = pageTops[2] + pageHeights[2];
    const maxScroll = documentHeight + viewportHeight - viewportHeight;

    expect(anchorToScrollTop({ page: 3, fraction: 0 }, pageTops, pageHeights, maxScroll)).toBe(
      pageTops[2]
    );
  });

  it("preserves a small marker-heading padding above a page start", () => {
    const tops = [12, 164, 596];
    const heights = [140, 420, 140];
    const markerTop = tops[2];
    const paddedTop = markerTop - 40;
    const anchor = scrollTopToAnchor(paddedTop, tops, heights);

    expect(anchor).toEqual({ page: 2, fraction: 0.9333333333333333 });
    expect(anchorToScrollTop(anchor!, tops, heights, 700)).toBe(paddedTop);
  });
});

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
