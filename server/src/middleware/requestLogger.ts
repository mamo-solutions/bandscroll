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

    // req.path is relative to the router mount in a finish handler, so use
    // originalUrl (strip any query string) for an absolute path to match on.
    const path = req.originalUrl.split("?")[0];
    const fields = {
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
    };

    const isNoise =
      status < 400 && (path === "/api/health" || /\/assets\//.test(path));

    if (status >= 500) log.error("request", fields);
    else if (status >= 400) log.warn("request", fields);
    else if (isNoise) log.debug("request", fields);
    else log.info("request", fields);
  });

  next();
};
