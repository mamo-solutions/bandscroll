import type { ErrorRequestHandler } from "express";
import { logger } from "../lib/logger.js";

const log = logger.child("http");

/**
 * Global Express error handler. Registered LAST so any error thrown or passed
 * to next(err) from a route lands here: it's logged with the stack and answered
 * with a generic 500 (unless the response already started). The resulting 500
 * is counted by requestLogger's finish handler, so this avoids double-counting.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  log.error("unhandled error", {
    method: req.method,
    path: req.originalUrl,
    err: err instanceof Error ? err : new Error(String(err)),
  });

  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: "internal" });
};
