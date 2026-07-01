import type { NextFunction, Request, Response } from "express";

type LoginAttemptState = {
  failedAttempts: number[];
  lockoutUntil: number;
};

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60_000;

const attemptsByIp = new Map<string, LoginAttemptState>();

function pruneFailures(state: LoginAttemptState, now: number): LoginAttemptState {
  return {
    failedAttempts: state.failedAttempts.filter((attemptAt) => now - attemptAt < LOGIN_WINDOW_MS),
    lockoutUntil: state.lockoutUntil > now ? state.lockoutUntil : 0,
  };
}

function getState(ip: string, now: number): LoginAttemptState {
  const existing = attemptsByIp.get(ip);
  const next = pruneFailures(existing ?? { failedAttempts: [], lockoutUntil: 0 }, now);
  attemptsByIp.set(ip, next);
  return next;
}

function keyFor(req: Request): string {
  return req.ip || "unknown";
}

export function requireLoginAttemptAllowed(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const now = Date.now();
  const state = getState(keyFor(req), now);
  if (state.lockoutUntil > now) {
    res.status(429).json({ error: "login-rate-limit" });
    return;
  }

  next();
}

export function recordFailedLoginAttempt(req: Request): void {
  const now = Date.now();
  const key = keyFor(req);
  const state = getState(key, now);
  state.failedAttempts.push(now);
  if (state.failedAttempts.length >= LOGIN_MAX_ATTEMPTS) {
    state.lockoutUntil = now + LOGIN_LOCKOUT_MS;
    state.failedAttempts = [];
  }
  attemptsByIp.set(key, state);
}

export function clearLoginAttemptFailures(req: Request): void {
  attemptsByIp.delete(keyFor(req));
}

export function resetLoginRateLimitState(): void {
  attemptsByIp.clear();
}
