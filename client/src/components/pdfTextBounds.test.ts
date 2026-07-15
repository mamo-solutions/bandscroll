import { describe, expect, it } from "vitest";
import { getSongEndProgress, getTextBottomInPagePx } from "./pdfTextBounds";

const viewport = {
  height: 1000,
  convertToViewportRectangle: ([left, bottom, right, top]: number[]) => [
    left,
    1000 - bottom,
    right,
    1000 - top,
  ],
};

describe("getTextBottomInPagePx", () => {
  it("uses the final text instead of trailing page whitespace", () => {
    const bottom = getTextBottomInPagePx(
      [
        { str: "Verse", transform: [1, 0, 0, 1, 20, 800], width: 100, height: 20 },
        { str: "Final line", transform: [1, 0, 0, 1, 20, 300], width: 120, height: 20 },
      ],
      viewport,
      1000
    );

    expect(bottom).toBe(700);
  });

  it("ignores whitespace-only text items", () => {
    expect(
      getTextBottomInPagePx(
        [{ str: "  ", transform: [1, 0, 0, 1, 20, 20], width: 100, height: 20 }],
        viewport,
        1000
      )
    ).toBeNull();
  });
});

describe("getSongEndProgress", () => {
  it("leaves a 15 percent bottom buffer after the final text", () => {
    expect(
      getSongEndProgress({
        pageTopPx: 1000,
        textBottomInPagePx: 720,
        viewportHeightPx: 1000,
        maxScrollPx: 4000,
        bottomBufferFraction: 0.15,
      })
    ).toBeCloseTo(0.2175);
  });

  it("clamps at the document bounds", () => {
    expect(
      getSongEndProgress({
        pageTopPx: 0,
        textBottomInPagePx: 20,
        viewportHeightPx: 1000,
        maxScrollPx: 4000,
        bottomBufferFraction: 0.15,
      })
    ).toBe(0);
  });
});
