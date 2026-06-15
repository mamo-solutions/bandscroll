import session from "express-session";
import type { RequestHandler } from "express";
import { env } from "./env.js";

declare module "express-session" {
  interface SessionData {
    isAdmin?: boolean;
  }
}

// Shared between Express and Socket.IO so the admin session cookie authenticates
// both HTTP requests and WebSocket connections.
export const sessionMiddleware: RequestHandler = session({
  name: "pdfsync.sid",
  secret: env.ADMIN_SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
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
