import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MarkerSuggestionStore } from "./markerSuggestionStore.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("MarkerSuggestionStore", () => {
  it("persists suggestion sets across reloads", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bandscroll-marker-suggestions-"));
    dirs.push(dataDir);

    const store = new MarkerSuggestionStore(dataDir);
    store.upsert({
      sessionId: "session-1",
      pdfUrl: "/uploads/demo.pdf",
      documentFingerprint: "abc123",
      provider: "openai",
      model: "gpt-4.1-mini",
      status: "ready",
      suggestions: [
        {
          id: "s1",
          title: "Amazing Grace",
          page: 2,
          confidence: 0.91,
          classification: "song-start",
          reason: "Found a new title heading.",
          source: "ai",
        },
      ],
      summary: {
        suggestionCount: 1,
        averageConfidence: 0.91,
        uncertainCount: 0,
      },
      createdAt: 1,
      updatedAt: 2,
    });
    store.close();

    const restored = new MarkerSuggestionStore(dataDir);
    expect(restored.get("session-1")?.suggestions[0]?.title).toBe("Amazing Grace");
    restored.close();
  });
});
