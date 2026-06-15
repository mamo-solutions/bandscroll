import { Router } from "express";
import { getSessionByCode, listPublicSessions } from "../sessionStore.js";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({ ok: true, time: Date.now() });
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
