import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The logger resolves its level/format from env at module load, so each test
// re-imports it under fresh env via resetModules + stubEnv.
async function loadLogger(level: string, format = "json") {
  vi.resetModules();
  vi.stubEnv("LOG_LEVEL", level);
  vi.stubEnv("LOG_FORMAT", format);
  return (await import("./logger.js")).logger;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("logger level gating", () => {
  it("suppresses debug/info when LOG_LEVEL=warn", async () => {
    const log = await loadLogger("warn");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(out).not.toHaveBeenCalled(); // debug+info dropped
    expect(err).toHaveBeenCalledTimes(2); // warn+error emitted
  });

  it("emits everything at LOG_LEVEL=debug", async () => {
    const log = await loadLogger("debug");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    log.debug("d");
    log.info("i");
    log.warn("w");

    expect(out).toHaveBeenCalledTimes(2); // debug+info via console.log
    expect(err).toHaveBeenCalledTimes(1); // warn via console.error
  });

  it("falls back to info threshold for an unknown level", async () => {
    const log = await loadLogger("bogus");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log.debug("d");
    log.info("i");
    expect(out).toHaveBeenCalledTimes(1); // only info passes
  });
});

describe("logger JSON output", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("emits a parseable record with level, time, msg and custom fields", async () => {
    const log = await loadLogger("info", "json");
    log.info("hello", { port: 3000, storage: "sqlite" });

    const line = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "info", msg: "hello", port: 3000, storage: "sqlite" });
    expect(typeof parsed.time).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.time))).toBe(false);
  });

  it("serializes Error fields to { message, stack }", async () => {
    const log = await loadLogger("info", "json");
    log.error("boom", { err: new Error("kaboom") });

    const line = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.err.message).toBe("kaboom");
    expect(parsed.err.stack).toContain("kaboom");
  });

  it("tags child loggers with a context field", async () => {
    const log = await loadLogger("info", "json");
    log.child("socket").info("connect", { id: "abc" });

    const line = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.parse(line)).toMatchObject({ context: "socket", msg: "connect", id: "abc" });
  });

  it("never throws on a circular field", async () => {
    const log = await loadLogger("info", "json");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => log.info("loop", { circular })).not.toThrow();
  });
});
