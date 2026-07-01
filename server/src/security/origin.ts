import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { IncomingMessage } from "node:http";
import { env } from "../env.js";

type AllowedOrigin = {
  origin: string;
  websocketOrigin: string;
};

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
  const allowed = allowedOrigin();
  if (!allowed) return ["'self'"];
  return [...new Set(["'self'", allowed.origin, allowed.websocketOrigin])];
}

export function isTrustedRequestOrigin(req: Request): boolean {
  const allowed = allowedOrigin();
  if (!allowed) return false;
  const candidateOrigin = requestOriginFromHeaders(req.headers);
  if (!candidateOrigin) return false;
  return matchesAllowedOrigin(candidateOrigin, allowed.origin);
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
  const allowed = allowedOrigin();
  if (!allowed) return false;

  const normalizedOrigin = normalizeHeaderOrigin(originHeader);
  if (!normalizedOrigin) return !env.isProduction;
  return matchesAllowedOrigin(normalizedOrigin, allowed.origin);
}
