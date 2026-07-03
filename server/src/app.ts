import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer, type Server as HttpServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env.js";
import { sessionMiddleware } from "./auth.js";
import { configureSessionStore } from "./sessionStore.js";
import { MemorySessionStore } from "./store/memorySessionStore.js";
import { FileSessionStore } from "./store/fileSessionStore.js";
import { SqliteSessionStore } from "./store/sqliteSessionStore.js";
import { publicRouter } from "./routes/publicRoutes.js";
import { adminRouter } from "./routes/adminRoutes.js";
import { initSocketServer } from "./sockets/socketServer.js";
import { logger } from "./lib/logger.js";
import { getSessionByCode } from "./sessionStore.js";
import { injectShareCard } from "./lib/shareCard.js";
import { hasSharePreview, sessionSharePreviewUrl } from "./lib/sharePreview.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { allowedConnectSources } from "./security/origin.js";

/**
 * Builds the fully wired Express app + HTTP server + Socket.IO, but does NOT
 * call listen(). Used by the entrypoint ([index.ts]) and by integration tests.
 */
export function createAppServer(): { app: express.Express; httpServer: HttpServer } {
  // Select the session storage backend before any route can touch the store.
  const storeAdapter =
    env.STORAGE === "file"
      ? new FileSessionStore(env.DATA_DIR)
      : env.STORAGE === "sqlite"
        ? new SqliteSessionStore(env.DATA_DIR)
        : new MemorySessionStore();
  configureSessionStore(storeAdapter);
  logger.info("storage backend selected", {
    storage: env.STORAGE,
    dataDir: env.STORAGE === "memory" ? undefined : env.DATA_DIR,
  });

  const app = express();
  app.disable("x-powered-by");
  if (env.isProduction) {
    app.set("trust proxy", 1); // behind one reverse proxy hop (Caddy) in production
    logger.info("production reverse proxy required", {
      trustedProxyHops: 1,
      directAppExposureSupported: false,
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: allowedConnectSources(),
          imgSrc: ["'self'", "data:", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          workerSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginOpenerPolicy: false,
      referrerPolicy: { policy: "no-referrer" },
    })
  );

  app.use(
    cors({
      // In production only accept the configured public origin;
      // in development reflect the request origin (Vite proxy / direct).
      origin: env.isProduction ? env.PUBLIC_BASE_URL : true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(requestLogger);
  app.use(sessionMiddleware);

  // API routes
  app.use("/api", publicRouter);
  app.use("/api/admin", adminRouter);

  // Uploaded files (PDF or image), read-only. Content-Type is inferred from the
  // stored extension by express.static. nosniff prevents browsers from
  // interpreting a polyglot file as HTML/JS if the extension is misleading.
  app.use(
    "/uploads",
    (_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      next();
    },
    express.static(env.UPLOAD_DIR)
  );

  app.use(
    "/share-previews",
    (_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=3600");
      next();
    },
    express.static(env.SHARE_PREVIEW_DIR)
  );

  // Serve the built React app in production (client dist copied into the image).
  const clientDist = resolve(process.cwd(), "../client/dist");
  if (existsSync(clientDist)) {
    const indexHtmlPath = resolve(clientDist, "index.html");

    const serveSessionShareCard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const code = String(req.params.code ?? "").replace(/\/$/, "");
      const session = getSessionByCode(code);
      if (!session) {
        logger.info("share-card: session not found", { code, path: req.path });
        return next();
      }
      let html: string;
      try {
        html = readFileSync(indexHtmlPath, "utf8");
      } catch (err) {
        logger.warn("share-card: failed to read index.html", { err });
        return next();
      }
      const canonicalUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/session/${session.code}`;
      const imageUrl = hasSharePreview(session)
        ? sessionSharePreviewUrl(session, env.PUBLIC_BASE_URL)
        : `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/favicon.svg`;
      logger.info("share-card: serving session metadata", {
        code: session.code,
        path: req.path,
        hasSharePreview: hasSharePreview(session),
        canonicalUrl,
        imageUrl,
      });
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(injectShareCard(html, session, { canonicalUrl, imageUrl }));
    };

    app.get("/session/:code", serveSessionShareCard);
    app.get("/session/:code/", serveSessionShareCard);

    app.use(
      express.static(clientDist, {
        setHeaders: (res, filePath) => {
          if (/[\\/]assets[\\/]/.test(filePath)) {
            // Content-hashed build assets (assets/*) — safe to cache forever.
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            // index.html, sw.js, registerSW.js, manifest — must revalidate every
            // load so a new deploy (and bug fixes) reach clients immediately
            // instead of being served stale from cache.
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );

    // SPA fallback for client-side routing (anything not /api or /uploads).
    app.get(/^\/(?!api|uploads|share-previews).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtmlPath);
    });
  }

  // Global error handler — registered last so it catches errors from any route.
  app.use(errorHandler);

  const httpServer = createServer(app);
  initSocketServer(httpServer, sessionMiddleware);

  return { app, httpServer };
}
