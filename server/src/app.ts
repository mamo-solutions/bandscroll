import express from "express";
import cors from "cors";
import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env.js";
import { sessionMiddleware } from "./auth.js";
import { publicRouter } from "./routes/publicRoutes.js";
import { adminRouter } from "./routes/adminRoutes.js";
import { initSocketServer } from "./sockets/socketServer.js";

/**
 * Builds the fully wired Express app + HTTP server + Socket.IO, but does NOT
 * call listen(). Used by the entrypoint ([index.ts]) and by integration tests.
 */
export function createAppServer(): { app: express.Express; httpServer: HttpServer } {
  const app = express();
  app.set("trust proxy", 1); // behind Caddy in production

  app.use(
    cors({
      origin: true, // reflect request origin (dev: vite proxy / direct)
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware);

  // API routes
  app.use("/api", publicRouter);
  app.use("/api/admin", adminRouter);

  // Uploaded PDFs (read-only static serving)
  app.use(
    "/uploads",
    express.static(env.UPLOAD_DIR, {
      setHeaders: (res) => res.setHeader("Content-Type", "application/pdf"),
    })
  );

  // Serve the built React app in production (client dist copied into the image).
  const clientDist = resolve(process.cwd(), "../client/dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // SPA fallback for client-side routing (anything not /api or /uploads).
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.sendFile(resolve(clientDist, "index.html"));
    });
  }

  const httpServer = createServer(app);
  initSocketServer(httpServer, sessionMiddleware);

  return { app, httpServer };
}
