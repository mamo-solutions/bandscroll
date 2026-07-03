import type { Request, RequestHandler } from "express";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_TESTS = 12;

const attempts = new Map<string, { count: number; resetAt: number }>();

function keyForRequest(req: Request): string {
  return req.sessionID ?? req.ip;
}

export const requireAiTestAttemptAllowed: RequestHandler = (req, res, next) => {
  const key = keyForRequest(req);
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
  }
  entry.count += 1;
  attempts.set(key, entry);

  if (entry.count > RATE_MAX_TESTS) {
    res.status(429).json({ error: "ai-test-rate-limit" });
    return;
  }
  next();
};

export function resetAiConfigRateLimitState(): void {
  attempts.clear();
}
