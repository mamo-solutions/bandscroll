import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampProgress,
  createSession,
  clampCurrentPage,
  decrementClientCount,
  deleteSession,
  endSession,
  getSessionByCode,
  getSessionById,
  incrementClientCount,
  listAdminSessions,
  listPublicSessions,
  setStatus,
  updateSessionState,
} from "./sessionStore.js";

// The store is a module-level singleton; clean up what each test creates.
const created: string[] = [];
function track<T extends { id: string }>(s: T): T {
  created.push(s.id);
  return s;
}
afterEach(() => {
  created.splice(0).forEach((id) => deleteSession(id));
  vi.useRealTimers();
});

describe("clampProgress", () => {
  it.each([
    [0, 0],
    [1, 1],
    [0.5, 0.5],
    [-0.2, 0],
    [1.5, 1],
    [NaN, 0],
  ])("clamps %s -> %s", (input, expected) => {
    expect(clampProgress(input)).toBe(expected);
  });
});

describe("clampCurrentPage", () => {
  it.each([
    [1, 1],
    [2.2, 2],
    [0, 1],
    [-5, 1],
    [NaN, 1],
  ])("clamps %s -> %s", (input, expected) => {
    expect(clampCurrentPage(input)).toBe(expected);
  });
});

describe("createSession", () => {
  it("applies sensible defaults", () => {
    const s = track(createSession({ title: "My Set" }));
    expect(s.id).toBeTruthy();
    expect(s.title).toBe("My Set");
    expect(s.description).toBeUndefined();
    expect(s.status).toBe("draft");
    expect(s.playing).toBe(false);
    expect(s.progress).toBe(0);
    expect(s.speed).toBe(0.0002);
    expect(s.pdfUrl).toBe("");
    expect(s.connectedClients).toBe(0);
    expect(s.createdAt).toBeTypeOf("number");
    expect(s.updatedAt).toBe(s.createdAt);
    expect(s.playbackMode).toBe("scroll");
    expect(s.currentPage).toBe(1);
  });

  it("generates a SESSION-#### code", () => {
    const s = track(createSession({ title: "x" }));
    expect(s.code).toMatch(/^SESSION-([0-9]{4}|[0-9A-F]{4})$/);
  });

  it("generates unique codes and ids across many sessions", () => {
    const sessions = Array.from({ length: 50 }, () =>
      track(createSession({ title: "x" }))
    );
    const codes = new Set(sessions.map((s) => s.code));
    const ids = new Set(sessions.map((s) => s.id));
    expect(codes.size).toBe(50);
    expect(ids.size).toBe(50);
  });

  it("trims title/description and falls back for empty title", () => {
    const s = track(createSession({ title: "  Padded  ", description: "  hi  " }));
    expect(s.title).toBe("Padded");
    expect(s.description).toBe("hi");

    const blank = track(createSession({ title: "   " }));
    expect(blank.title).toBe("Untitled Session");
  });
});

describe("lookups", () => {
  it("finds by id and by code (case-insensitive, trimmed)", () => {
    const s = track(createSession({ title: "Lookup" }));
    expect(getSessionById(s.id)).toBe(s);
    expect(getSessionByCode(s.code)).toBe(s);
    expect(getSessionByCode(`  ${s.code.toLowerCase()}  `)).toBe(s);
  });

  it("returns undefined for unknown id/code", () => {
    expect(getSessionById("nope")).toBeUndefined();
    expect(getSessionByCode("SESSION-0000")).toBeUndefined();
  });
});

describe("updateSessionState", () => {
  it("patches fields and bumps updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const s = track(createSession({ title: "u" }));
    vi.setSystemTime(5_000);

    const updated = updateSessionState(s.id, { playing: true, speed: 0.002 });
    expect(updated?.playing).toBe(true);
    expect(updated?.speed).toBe(0.002);
    expect(updated?.updatedAt).toBe(5_000);
  });

  it("clamps progress on update", () => {
    const s = track(createSession({ title: "u" }));
    expect(updateSessionState(s.id, { progress: 2 })?.progress).toBe(1);
    expect(updateSessionState(s.id, { progress: -1 })?.progress).toBe(0);
  });

  it("clamps currentPage on update", () => {
    const s = track(createSession({ title: "u" }));
    expect(updateSessionState(s.id, { currentPage: 2.8 })?.currentPage).toBe(3);
    expect(updateSessionState(s.id, { currentPage: -1 })?.currentPage).toBe(1);
  });

  it("returns undefined for a missing session", () => {
    expect(updateSessionState("missing", { playing: true })).toBeUndefined();
  });

  it("setStatus updates status", () => {
    const s = track(createSession({ title: "u" }));
    expect(setStatus(s.id, "live")?.status).toBe("live");
  });
});

describe("endSession", () => {
  it("marks ended and stops playing", () => {
    const s = track(createSession({ title: "e" }));
    updateSessionState(s.id, { status: "live", playing: true });
    const ended = endSession(s.id);
    expect(ended?.status).toBe("ended");
    expect(ended?.playing).toBe(false);
  });

  it("returns undefined for a missing session", () => {
    expect(endSession("missing")).toBeUndefined();
  });
});

describe("public vs admin listing", () => {
  it("public list excludes ended; admin list includes everything", () => {
    const draft = track(createSession({ title: "draft" }));
    const live = track(createSession({ title: "live" }));
    updateSessionState(live.id, { status: "live" });
    const gone = track(createSession({ title: "gone" }));
    endSession(gone.id);

    const publicIds = listPublicSessions().map((s) => s.id);
    expect(publicIds).toContain(draft.id);
    expect(publicIds).toContain(live.id);
    expect(publicIds).not.toContain(gone.id);

    const adminIds = listAdminSessions().map((s) => s.id);
    expect(adminIds).toContain(gone.id);
  });

  it("sorts newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const older = track(createSession({ title: "older" }));
    vi.setSystemTime(2_000);
    const newer = track(createSession({ title: "newer" }));

    const ids = listPublicSessions().map((s) => s.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });
});

describe("deleteSession", () => {
  it("removes a session and reports success", () => {
    const s = createSession({ title: "d" });
    expect(deleteSession(s.id)).toBe(true);
    expect(getSessionById(s.id)).toBeUndefined();
    expect(deleteSession(s.id)).toBe(false);
  });
});

describe("client counts", () => {
  it("increments, decrements and floors at zero", () => {
    const s = track(createSession({ title: "c" }));
    expect(incrementClientCount(s.id)).toBe(1);
    expect(incrementClientCount(s.id)).toBe(2);
    expect(decrementClientCount(s.id)).toBe(1);
    expect(decrementClientCount(s.id)).toBe(0);
    expect(decrementClientCount(s.id)).toBe(0); // never negative
  });

  it("returns 0 for an unknown session", () => {
    expect(incrementClientCount("missing")).toBe(0);
    expect(decrementClientCount("missing")).toBe(0);
  });
});
