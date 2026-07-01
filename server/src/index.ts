import { env } from "./env.js";
import { createAppServer } from "./app.js";
import { logger } from "./lib/logger.js";
import { metrics } from "./lib/metrics.js";

const { httpServer } = createAppServer();

httpServer.listen(env.PORT, () => {
  logger.info("server listening", {
    url: `http://localhost:${env.PORT}`,
    uploadDir: env.UPLOAD_DIR,
    env: env.NODE_ENV,
    storage: env.STORAGE,
    logLevel: env.LOG_LEVEL,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    reverseProxyRequired: env.isProduction,
  });

  // Periodic performance-stats summary. unref() so it never blocks shutdown.
  if (env.METRICS_INTERVAL_MS > 0) {
    setInterval(() => {
      logger.info("metrics", metrics.snapshot());
    }, env.METRICS_INTERVAL_MS).unref();
  }
});
