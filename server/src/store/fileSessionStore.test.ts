import { chmodSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "./fileSessionStore.js";
import type { SessionState } from "../types.js";

function makeSession(overrides?: Partial<SessionState>): SessionState {
  return {
    id: "session-id",
    code: "SESSION-1234",
    title: "Test",
    description: "A test session",
    pdfUrl: "/uploads/file.pdf",
    status: "live",
    playing: true,
    progress: 0.42,
    speed: 0.002,
    updatedAt: 1_000,
    connectedClients: 7,
    createdAt: 500,
    markers: [],
    locked: false,
    playbackMode: "page",
    backgroundMode: "black",
    autoStopAtSongEnd: true,
    currentPage: 4,
    numPages: 12,
    stateVersion: 3,
    ...overrides,
  };
}

describe("FileSessionStore", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bandscroll-file-store-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists sessions across adapter instances", () => {
    const first = new FileSessionStore(dataDir);
    const session = makeSession();
    first.set(session.id, session);

    const second = new FileSessionStore(dataDir);
    const restored = second.get(session.id);

    expect(restored).toBeDefined();
    expect(restored?.title).toBe("Test");
    expect(restored?.status).toBe("live");
    expect(restored?.progress).toBe(0.42);
  });

  it("resets transient runtime fields on load", () => {
    const first = new FileSessionStore(dataDir);
    first.set("session-id", makeSession());

    const second = new FileSessionStore(dataDir);
    const restored = second.get("session-id")!;

    expect(restored.connectedClients).toBe(0);
    expect(restored.updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("deletes sessions and removes them from disk", () => {
    const store = new FileSessionStore(dataDir);
    store.set("a", makeSession({ id: "a" }));
    store.set("b", makeSession({ id: "b" }));

    expect(store.delete("a")).toBe(true);
    expect(store.get("a")).toBeUndefined();

    const reloaded = new FileSessionStore(dataDir);
    expect(reloaded.get("a")).toBeUndefined();
    expect(reloaded.get("b")).toBeDefined();
  });

  it("returns false when deleting a missing session", () => {
    const store = new FileSessionStore(dataDir);
    expect(store.delete("missing")).toBe(false);
  });

  it("clears all persisted sessions", () => {
    const store = new FileSessionStore(dataDir);
    store.set("a", makeSession({ id: "a" }));
    store.set("b", makeSession({ id: "b" }));

    store.clear();
    expect([...store.values()]).toHaveLength(0);

    const reloaded = new FileSessionStore(dataDir);
    expect([...reloaded.values()]).toHaveLength(0);
  });

  it("starts empty when the data directory is fresh", () => {
    const store = new FileSessionStore(dataDir);
    expect([...store.values()]).toHaveLength(0);
  });

  it("starts empty when the persisted file is corrupt", () => {
    const first = new FileSessionStore(dataDir);
    first.set("a", makeSession({ id: "a" }));

    writeFileSync(join(dataDir, "sessions.json"), "not-json");

    const restored = new FileSessionStore(dataDir);
    expect([...restored.values()]).toHaveLength(0);
  });

  it("backfills schema fields missing on older persisted rows", () => {
    const first = new FileSessionStore(dataDir);
    const legacy = makeSession();
    delete (legacy as Partial<SessionState>).markers;
    delete (legacy as Partial<SessionState>).locked;
    delete (legacy as Partial<SessionState>).playbackMode;
    delete (legacy as Partial<SessionState>).backgroundMode;
    delete (legacy as Partial<SessionState>).autoStopAtSongEnd;
    delete (legacy as Partial<SessionState>).currentPage;
    delete (legacy as Partial<SessionState>).numPages;
    delete (legacy as Partial<SessionState>).stateVersion;
    first.set(legacy.id, legacy as SessionState);

    const restored = new FileSessionStore(dataDir).get(legacy.id)!;
    expect(restored.markers).toEqual([]);
    expect(restored.locked).toBe(false);
    expect(restored.playbackMode).toBe("scroll");
    expect(restored.backgroundMode).toBe("light");
    expect(restored.autoStopAtSongEnd).toBe(false);
    expect(restored.currentPage).toBe(1);
    expect(restored.numPages).toBe(0);
    expect(restored.stateVersion).toBe(0);
  });

  it("rewrites a read-only session file via temp file replacement", () => {
    const store = new FileSessionStore(dataDir);
    const sessionPath = join(dataDir, "sessions.json");

    store.set("a", makeSession({ id: "a" }));
    chmodSync(sessionPath, 0o444);

    expect(() => store.delete("a")).not.toThrow();

    const reloaded = new FileSessionStore(dataDir);
    expect(reloaded.get("a")).toBeUndefined();
  });
});
