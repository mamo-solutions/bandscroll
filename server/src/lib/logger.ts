import { env } from "../env.js";

// Tiny structured logger — zero dependencies. Emits one JSON object per line in
// production (grep/scrape friendly) and a compact pretty line in development.
// Level-gated via LOG_LEVEL so high-frequency debug calls cost nothing once the
// threshold drops them. Must never throw: a logging failure must not crash a
// request or a socket handler.

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveThreshold(): number {
  const level = env.LOG_LEVEL as LogLevel;
  return RANK[level] ?? RANK.info;
}

const threshold = resolveThreshold();
const pretty = env.LOG_FORMAT !== "json";

type Fields = Record<string, unknown>;

/** Replace Error values with a serializable { message, stack } shape. */
function serializeFields(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      value instanceof Error
        ? { message: value.message, stack: value.stack }
        : value;
  }
  return out;
}

function emit(level: LogLevel, msg: string, fields?: Fields, context?: string): void {
  if (RANK[level] < threshold) return;
  try {
    const base: Fields = { level, time: new Date().toISOString(), msg };
    if (context) base.context = context;
    const record = { ...base, ...(fields ? serializeFields(fields) : {}) };
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    if (pretty) {
      const tag = context ? `${context}:` : "";
      // Keep only the extra fields for the pretty trailer.
      const { level: _l, time: _t, msg: _m, context: _c, ...rest } = record;
      void _l, _t, _m, _c;
      sink(`${base.time} ${level.toUpperCase()} ${tag}${msg}`, rest);
    } else {
      sink(JSON.stringify(record));
    }
  } catch {
    // A logging failure must never propagate.
  }
}

export type Logger = {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** Returns a logger that tags every line with a `context` field. */
  child(context: string): Logger;
};

function makeLogger(context?: string): Logger {
  return {
    debug: (msg, fields) => emit("debug", msg, fields, context),
    info: (msg, fields) => emit("info", msg, fields, context),
    warn: (msg, fields) => emit("warn", msg, fields, context),
    error: (msg, fields) => emit("error", msg, fields, context),
    child: (childContext) =>
      makeLogger(context ? `${context}.${childContext}` : childContext),
  };
}

export const logger = makeLogger();
