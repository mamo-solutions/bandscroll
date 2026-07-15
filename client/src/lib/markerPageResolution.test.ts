import { describe, expect, it } from "vitest";
import type { SongMarker } from "@/types/session";
import { resolveMarkerPages } from "./markerPageResolution";

function marker(id: string, title: string, page: number): SongMarker {
  return { id, title, page };
}

describe("resolveMarkerPages", () => {
  it("repairs markers against later title hits without wrapping back to a contents page", async () => {
    const markers = [
      marker("1", "All The Small Things", 5),
      marker("2", "Bad Moon Rising", 9),
      marker("3", "Last Christmas", 43),
    ];
    const hits = new Map<string, number>([
      ["All The Small Things", 4],
      ["Bad Moon Rising", 12],
      ["Last Christmas", 80],
    ]);

    const repaired = await resolveMarkerPages(markers, 174, async (title, minimumPage) => {
      const hit = hits.get(title);
      return hit !== undefined && hit >= minimumPage ? hit : null;
    });

    expect(repaired.map((entry) => entry.page)).toEqual([4, 12, 80]);
  });

  it("fills unresolved markers from neighboring resolved pages", async () => {
    const markers = [
      marker("1", "Whats Up", 83),
      marker("2", "Whisky In The Jar", 84),
      marker("3", "Wie schön, dass du geboren bist", 85),
    ];
    const hits = new Map<string, number>([
      ["Whats Up", 160],
      ["Wie schön, dass du geboren bist", 164],
    ]);

    const repaired = await resolveMarkerPages(markers, 174, async (title, minimumPage) => {
      const hit = hits.get(title);
      return hit !== undefined && hit >= minimumPage ? hit : null;
    });

    expect(repaired.map((entry) => entry.page)).toEqual([160, 162, 164]);
  });
});
