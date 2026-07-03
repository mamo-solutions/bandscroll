import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteSessionStore } from "./sqliteSessionStore.js";
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
    markers: [{ id: "m1", title: "Verse", page: 2 }],
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

describe("SqliteSessionStore", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bandscroll-sqlite-store-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists sessions across adapter instances", () => {
    const first = new SqliteSessionStore(dataDir);
    first.set("session-id", makeSession());
    first.close();

    const second = new SqliteSessionStore(dataDir);
    const restored = second.get("session-id");
    second.close();

    expect(restored).toBeDefined();
    expect(restored?.title).toBe("Test");
    expect(restored?.status).toBe("live");
    expect(restored?.progress).toBe(0.42);
    expect(restored?.markers).toEqual([{ id: "m1", title: "Verse", page: 2 }]);
  });

  it("resets transient runtime fields on load", () => {
    const first = new SqliteSessionStore(dataDir);
    first.set("session-id", makeSession());
    first.close();

    const second = new SqliteSessionStore(dataDir);
    const restored = second.get("session-id")!;
    second.close();

    expect(restored.connectedClients).toBe(0);
    expect(restored.updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("updates an existing session in place (upsert)", () => {
    const store = new SqliteSessionStore(dataDir);
    store.set("session-id", makeSession({ progress: 0.1 }));
    store.set("session-id", makeSession({ progress: 0.9, status: "ended" }));
    store.close();

    const reloaded = new SqliteSessionStore(dataDir);
    const restored = reloaded.get("session-id")!;
    reloaded.close();

    expect(restored.progress).toBe(0.9);
    expect(restored.status).toBe("ended");
  });

  it("deletes sessions and removes them from disk", () => {
    const store = new SqliteSessionStore(dataDir);
    store.set("a", makeSession({ id: "a" }));
    store.set("b", makeSession({ id: "b" }));

    expect(store.delete("a")).toBe(true);
    expect(store.get("a")).toBeUndefined();
    store.close();

    const reloaded = new SqliteSessionStore(dataDir);
    expect(reloaded.get("a")).toBeUndefined();
    expect(reloaded.get("b")).toBeDefined();
    reloaded.close();
  });

  it("returns false when deleting a missing session", () => {
    const store = new SqliteSessionStore(dataDir);
    expect(store.delete("missing")).toBe(false);
    store.close();
  });

  it("starts empty when the data directory is fresh", () => {
    const store = new SqliteSessionStore(dataDir);
    expect([...store.values()]).toHaveLength(0);
    store.close();
  });

  it("backfills schema fields missing on older persisted rows", () => {
    // Simulate a row written by an older server version without markers/locked.
    const db = new Database(join(dataDir, "sessions.db"));
    db.exec(
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, code TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL)`
    );
    const legacy = makeSession();
    delete (legacy as Partial<SessionState>).markers;
    delete (legacy as Partial<SessionState>).locked;
    delete (legacy as Partial<SessionState>).playbackMode;
    delete (legacy as Partial<SessionState>).backgroundMode;
    delete (legacy as Partial<SessionState>).autoStopAtSongEnd;
    delete (legacy as Partial<SessionState>).currentPage;
    delete (legacy as Partial<SessionState>).numPages;
    delete (legacy as Partial<SessionState>).stateVersion;
    db.prepare(
      `INSERT INTO sessions (id, code, status, created_at, data) VALUES (?, ?, ?, ?, ?)`
    ).run(
      legacy.id,
      legacy.code,
      legacy.status,
      legacy.createdAt,
      JSON.stringify(legacy)
    );
    db.close();

    const store = new SqliteSessionStore(dataDir);
    const restored = store.get("session-id")!;
    store.close();

    expect(restored.markers).toEqual([]);
    expect(restored.locked).toBe(false);
    expect(restored.playbackMode).toBe("scroll");
    expect(restored.backgroundMode).toBe("light");
    expect(restored.autoStopAtSongEnd).toBe(false);
    expect(restored.currentPage).toBe(1);
    expect(restored.numPages).toBe(0);
    expect(restored.stateVersion).toBe(0);
  });

  it("skips a corrupt row without failing the whole load", () => {
    const good = makeSession({ id: "good" });
    const db = new Database(join(dataDir, "sessions.db"));
    db.exec(
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, code TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL)`
    );
    const insert = db.prepare(
      `INSERT INTO sessions (id, code, status, created_at, data) VALUES (?, ?, ?, ?, ?)`
    );
    insert.run("bad", "SESSION-0000", "live", 1, "not-json");
    insert.run(good.id, good.code, good.status, good.createdAt, JSON.stringify(good));
    db.close();

    const store = new SqliteSessionStore(dataDir);
    expect(store.get("bad")).toBeUndefined();
    expect(store.get("good")).toBeDefined();
    store.close();
  });
});
