import type { NextFunction, Request, Response } from "express";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 6;

const attempts = new Map<string, { count: number; resetAt: number }>();

export function requireMarkerGenerationAttemptAllowed(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = req.sessionID ?? req.ip;
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
  }
  entry.count += 1;
  attempts.set(key, entry);

  if (entry.count > RATE_MAX_ATTEMPTS) {
    res.status(429).json({ error: "marker-generation-rate-limit" });
    return;
  }

  next();
}

export function resetMarkerGenerationRateLimitState(): void {
  attempts.clear();
}
