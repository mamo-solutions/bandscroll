import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { IncomingMessage } from "node:http";
import { env } from "../env.js";

type AllowedOrigin = {
  origin: string;
  websocketOrigin: string;
};

const DEV_APP_ORIGINS = [
  "http://localhost:5173",
  "ws://localhost:5173",
  "http://127.0.0.1:5173",
  "ws://127.0.0.1:5173",
] as const;

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeHeaderOrigin(value: string | undefined): string | null {
  if (!value) return null;
  return normalizeOrigin(value);
}

function allowedOrigin(): AllowedOrigin | null {
  const origin = normalizeOrigin(env.PUBLIC_BASE_URL);
  if (!origin) return null;
  const websocketOrigin = origin.replace(/^http/i, "ws");
  return { origin, websocketOrigin };
}

function allowedOrigins(): string[] {
  const allowed = allowedOrigin();
  const origins = allowed ? [allowed.origin, allowed.websocketOrigin] : [];
  if (!env.isProduction) origins.push(...DEV_APP_ORIGINS);
  return [...new Set(origins)];
}

function requestOriginFromHeaders(headers: IncomingMessage["headers"]): string | null {
  const rawOrigin = typeof headers.origin === "string" ? headers.origin : undefined;
  const normalizedOrigin = normalizeHeaderOrigin(rawOrigin);
  if (normalizedOrigin) return normalizedOrigin;

  const rawReferer = typeof headers.referer === "string" ? headers.referer : undefined;
  return normalizeHeaderOrigin(rawReferer);
}

function matchesAllowedOrigin(candidateOrigin: string, allowedOriginValue: string): boolean {
  if (candidateOrigin === allowedOriginValue) return true;
  if (env.NODE_ENV !== "test") return false;

  try {
    const candidate = new URL(candidateOrigin);
    const allowed = new URL(allowedOriginValue);
    return candidate.protocol === allowed.protocol && candidate.hostname === allowed.hostname;
  } catch {
    return false;
  }
}

export function allowedConnectSources(): string[] {
  const origins = allowedOrigins();
  if (origins.length === 0) return ["'self'"];
  return [...new Set(["'self'", ...origins])];
}

export function isTrustedRequestOrigin(req: Request): boolean {
  const candidateOrigin = requestOriginFromHeaders(req.headers);
  if (!candidateOrigin) return false;
  return allowedOrigins().some((allowed) => matchesAllowedOrigin(candidateOrigin, allowed));
}

export const requireTrustedAdminOrigin: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (isTrustedRequestOrigin(req)) {
    next();
    return;
  }

  res.status(403).json({ error: "invalid-origin" });
};

export function isAllowedSocketOrigin(originHeader: string | undefined): boolean {
  const normalizedOrigin = normalizeHeaderOrigin(originHeader);
  if (!normalizedOrigin) return !env.isProduction;
  return allowedOrigins().some((allowed) => matchesAllowedOrigin(normalizedOrigin, allowed));
}
