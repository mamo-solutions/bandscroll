import { describe, expect, it } from "vitest";
import {
  advanceDocumentCursor,
  clampDocumentCursor,
  createDocumentGeometry,
  pageForDocumentCursor,
} from "./documentPosition.js";

describe("canonical document coordinates", () => {
  const geometry = createDocumentGeometry("revision-a", [100, 250, 50]);

  it("crosses unequal intrinsic page heights without percentages", () => {
    const cursor = advanceDocumentCursor(
      { revision: "revision-a", yMicroPoints: 90_000 },
      geometry,
      20,
      1_000
    );
    expect(cursor.yMicroPoints).toBe(110_000);
    expect(pageForDocumentCursor(cursor, geometry)).toBe(2);
  });

  it("clamps cursor positions to the immutable document extent", () => {
    expect(
      clampDocumentCursor({ revision: "revision-a", yMicroPoints: 999_999 }, geometry)
    ).toEqual({ revision: "revision-a", yMicroPoints: 400_000 });
    expect(clampDocumentCursor({ revision: "wrong", yMicroPoints: 0 }, geometry)).toBeUndefined();
  });
});
