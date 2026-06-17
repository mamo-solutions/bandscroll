import session from "express-session";
import FileStore from "session-file-store";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { RequestHandler } from "express";
import { env } from "./env.js";

declare module "express-session" {
  interface SessionData {
    isAdmin?: boolean;
  }
}

const FileStoreSession = FileStore(session);

function createSessionStore() {
  if (!env.isProduction) return undefined;
  const path = resolve(env.DATA_DIR, "sessions-cookies");
  mkdirSync(path, { recursive: true });
  return new FileStoreSession({ path, retries: 0 });
}

// Shared between Express and Socket.IO so the admin session cookie authenticates
// both HTTP requests and WebSocket connections.
export const sessionMiddleware: RequestHandler = session({
  name: "pdfsync.sid",
  secret: env.ADMIN_SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: createSessionStore(),
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: env.isProduction,
    maxAge: 1000 * 60 * 60 * 12, // 12h
  },
});

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: "unauthorized" });
};

/** Constant-time-ish password check. Password comes only from the backend env. */
export function checkPassword(candidate: unknown): boolean {
  return typeof candidate === "string" && candidate === env.ADMIN_PASSWORD;
}
