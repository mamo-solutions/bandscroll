import { Router } from "express";
import { getSessionByCode, listPublicSessions } from "../sessionStore.js";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// Client-side error reporting. The browser POSTs uncaught errors here so crashes
// that have no visible console (e.g. mobile Safari) still land in the server log.
publicRouter.post("/client-log", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, max) : undefined;

  console.error("[client-error]", {
    context: str(body.context, 80),
    message: str(body.message, 500),
    url: str(body.url, 300),
    viewport: str(body.viewport, 60),
    userAgent: str(body.userAgent, 300),
    stack: str(body.stack, 1500),
    componentStack: str(body.componentStack, 1500),
    at: new Date().toISOString(),
  });
  res.status(204).end();
});

publicRouter.get("/sessions/public", (_req, res) => {
  res.json(listPublicSessions());
});

publicRouter.get("/sessions/code/:code", (req, res) => {
  const session = getSessionByCode(req.params.code);
  if (!session || session.status === "ended") {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  res.json(session);
});
