import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";

const log = logger.child("http");

/**
 * Logs one line per request (method, path, status, duration) and feeds the
 * metrics registry. Successful health checks and static assets are demoted to
 * debug so polling/asset traffic doesn't drown the log.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    metrics.recordRequest(durationMs, status);

    const fields = {
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
    };

    // Successful requests are debug-only so they don't flood the log at the
    // default level; client/server faults stay visible at warn/error.
    if (status >= 500) log.error("request", fields);
    else if (status >= 400) log.warn("request", fields);
    else log.debug("request", fields);
  });

  next();
};
