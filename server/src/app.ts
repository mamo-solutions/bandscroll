import express from "express";
import cors from "cors";
import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
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

  const app = express();
  app.set("trust proxy", 1); // behind Caddy in production

  app.use(
    cors({
      // In production only accept the configured public origin;
      // in development reflect the request origin (Vite proxy / direct).
      origin: env.isProduction ? env.PUBLIC_BASE_URL : true,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
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

  // Serve the built React app in production (client dist copied into the image).
  const clientDist = resolve(process.cwd(), "../client/dist");
  if (existsSync(clientDist)) {
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
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(resolve(clientDist, "index.html"));
    });
  }

  const httpServer = createServer(app);
  initSocketServer(httpServer, sessionMiddleware);

  return { app, httpServer };
}
