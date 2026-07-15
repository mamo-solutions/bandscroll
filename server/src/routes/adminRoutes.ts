import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import type { Request, Response, NextFunction } from "express";
import { env } from "../env.js";
import { checkPassword, requireAdmin } from "../auth.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import {
  clearLoginAttemptFailures,
  recordFailedLoginAttempt,
  requireLoginAttemptAllowed,
} from "../security/loginRateLimit.js";
import { requireTrustedAdminOrigin } from "../security/origin.js";
import { requireAiTestAttemptAllowed } from "../security/aiConfigRateLimit.js";
import { requireMarkerGenerationAttemptAllowed } from "../security/markerGenerationRateLimit.js";
import { validateUploadFile } from "../uploads/validate.js";
import {
  createSession,
  deleteSession,
  endSession,
  getSessionById,
  listAdminSessions,
  toggleSessionLock,
  updateSessionState,
  clampProgress,
} from "../sessionStore.js";
import {
  broadcastSessionEnded,
  broadcastSessionListUpdated,
  broadcastSessionState,
} from "../sockets/socketServer.js";
import { removeObsoleteUpload } from "../uploads/cleanup.js";
import {
  refreshSessionSharePreview,
  removeSessionSharePreview,
} from "../lib/sharePreview.js";
import {
  acknowledgeAdminNotification,
  AiConfigError,
  deleteAiProviderConfig,
  getAiConfigSummary,
  listAdminNotifications,
  listAiProviders,
  MarkerGenerationService,
  saveAiProviderConfig,
  testAiProviderConfig,
} from "../ai/service.js";

export const adminRouter = Router();
const markerGenerationService = new MarkerGenerationService();

// ---- Upload setup (admin only; PDF or image; random safe filename) ----
if (!existsSync(env.UPLOAD_DIR)) {
  mkdirSync(env.UPLOAD_DIR, { recursive: true });
}

// Allowed upload types -> the extension we store them under. The stored name is
// always a random UUID + this extension (never the client filename), so it is
// path-traversal safe and serves with the correct Content-Type.
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype] ?? ".bin";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype in ALLOWED_TYPES);
  },
});

// ---- Upload rate limiting (per admin session) ----
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_UPLOADS = 10;

const uploadCounts = new Map<string, { count: number; resetAt: number }>();

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function rateLimitUpload(req: Request, res: Response, next: NextFunction): void {
  const key = req.sessionID ?? req.ip;
  const now = Date.now();
  let entry = uploadCounts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
  }
  entry.count++;
  uploadCounts.set(key, entry);

  if (entry.count > RATE_MAX_UPLOADS) {
    res.status(429).json({ error: "upload-rate-limit" });
    return;
  }
  next();
}

// ---- Auth ----
adminRouter.post("/login", requireLoginAttemptAllowed, (req, res) => {
  if (!checkPassword(req.body?.password)) {
    recordFailedLoginAttempt(req);
    res.status(401).json({ error: "invalid-password" });
    return;
  }
  clearLoginAttemptFailures(req);
  req.session.isAdmin = true;
  res.json({ ok: true });
});

adminRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pdfsync.sid");
    res.json({ ok: true });
  });
});

adminRouter.get("/me", (req, res) => {
  res.json({ isAdmin: req.session?.isAdmin === true });
});

// ---- Everything below requires admin ----
adminRouter.use(requireAdmin);
adminRouter.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  requireTrustedAdminOrigin(req, res, next);
});

adminRouter.get("/sessions", (_req, res) => {
  res.json(listAdminSessions());
});

// Live performance stats (process + app). Admin-guarded so process internals
// aren't exposed publicly on a self-hosted box.
adminRouter.get("/metrics", (_req, res) => {
  res.json(metrics.snapshot());
});

adminRouter.get("/ai/providers", (_req, res) => {
  res.json(listAiProviders());
});

adminRouter.get("/ai/config", (_req, res) => {
  try {
    res.json(getAiConfigSummary());
  } catch (err) {
    handleAiConfigError(err, res);
  }
});

adminRouter.put("/ai/config/:provider", (req, res) => {
  try {
    const summary = saveAiProviderConfig(req.params.provider, req.body ?? {});
    logger.info("ai config saved", {
      provider: summary.provider,
      isDefault: summary.isDefault,
      capabilities: summary.capabilities,
    });
    res.json(summary);
  } catch (err) {
    handleAiConfigError(err, res);
  }
});

adminRouter.post("/ai/config/:provider/test", requireAiTestAttemptAllowed, async (req, res) => {
  try {
    const result = await testAiProviderConfig(req.params.provider);
    logger.info("ai config tested", {
      provider: result.provider,
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error,
    });
    res.json(result);
  } catch (err) {
    handleAiConfigError(err, res);
  }
});

adminRouter.delete("/ai/config/:provider", (req, res) => {
  try {
    const deleted = deleteAiProviderConfig(req.params.provider);
    if (!deleted) {
      res.status(404).json({ error: "ai-config-not-found" });
      return;
    }
    logger.info("ai config deleted", { provider: req.params.provider });
    res.json({ ok: true });
  } catch (err) {
    handleAiConfigError(err, res);
  }
});

adminRouter.get("/notifications", (_req, res) => {
  res.json(listAdminNotifications());
});

adminRouter.post("/notifications/:id/ack", (req, res) => {
  const acknowledged = acknowledgeAdminNotification(req.params.id);
  if (!acknowledged) {
    res.status(404).json({ error: "notification-not-found" });
    return;
  }
  res.json({ ok: true });
});

adminRouter.get("/sessions/:id/markers/suggestions", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }

  const suggestions = markerGenerationService.getSuggestions(session.id);
  if (!suggestions) {
    res.status(404).json({ error: "suggestions-not-found" });
    return;
  }

  if (suggestions.pdfUrl !== session.pdfUrl) {
    markerGenerationService.invalidateSuggestionsForSession(session.id);
    res.status(404).json({ error: "suggestions-not-found" });
    return;
  }

  res.json(suggestions);
});

adminRouter.post(
  "/sessions/:id/markers/generate",
  requireMarkerGenerationAttemptAllowed,
  (req, res) => {
    const session = getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session-not-found" });
      return;
    }

    try {
      const suggestions = markerGenerationService.startGeneration(session);
      res.status(202).json(suggestions);
    } catch (err) {
      handleAiConfigError(err, res);
    }
  }
);

adminRouter.post("/sessions/:id/markers/apply-suggestions", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }

  try {
    const updated = markerGenerationService.applySuggestions(
      session,
      Array.isArray(req.body?.suggestions) ? req.body.suggestions : undefined
    );
    broadcastSessionState(updated);
    res.json(updated);
  } catch (err) {
    handleAiConfigError(err, res);
  }
});

adminRouter.delete("/sessions/:id/markers/suggestions", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }

  const cleared = markerGenerationService.clearSuggestions(session.id);
  if (!cleared) {
    res.status(404).json({ error: "suggestions-not-found" });
    return;
  }
  res.json({ ok: true });
});

adminRouter.post("/sessions", (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "title-required" });
    return;
  }
  const session = createSession({
    title,
    description: normalizeOptionalText(req.body?.description),
    documentDescription: normalizeOptionalText(req.body?.documentDescription),
  });
  broadcastSessionListUpdated();
  res.status(201).json(session);
});

function handleAiConfigError(err: unknown, res: Response): void {
  if (!(err instanceof AiConfigError)) {
    throw err;
  }

  const statusByCode: Record<AiConfigError["code"], number> = {
    "invalid-provider": 404,
    "encryption-unavailable": 503,
    "api-key-required": 400,
    "base-url-required": 400,
    "base-url-unsupported": 400,
    "invalid-base-url": 400,
    "invalid-capabilities": 400,
    "config-not-found": 404,
    "marker-generation-disabled": 400,
    "marker-generation-unavailable": 502,
    "marker-generation-in-progress": 409,
    "document-required": 400,
    "document-description-required": 400,
    "suggestions-not-found": 404,
  };

  res.status(statusByCode[err.code]).json({ error: err.code, message: err.message });
}

adminRouter.patch("/sessions/:id", async (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }

  const patch: {
    title?: string;
    description?: string;
    documentDescription?: string;
  } = {};
  if (typeof req.body?.title === "string") {
    patch.title = String(req.body.title).trim() || session.title;
  }
  if (req.body && "description" in req.body) {
    patch.description = normalizeOptionalText(req.body.description);
  }
  if (req.body && "documentDescription" in req.body) {
    patch.documentDescription = normalizeOptionalText(req.body.documentDescription);
  }

  const updated = updateSessionState(session.id, patch);
  if (!updated) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(updated);
  broadcastSessionListUpdated();
  if (updated.pdfUrl && patch.title !== undefined) {
    await refreshSessionSharePreview(updated);
  }
  res.json(updated);
});

adminRouter.get("/sessions/:id", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  res.json(session);
});

adminRouter.post(
  "/sessions/:id/pdf",
  rateLimitUpload,
  upload.single("pdf"),
  async (req, res) => {
    const session = getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session-not-found" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "pdf-required-or-invalid" });
      return;
    }
    if (!validateUploadFile(req.file.path, req.file.mimetype)) {
      // The mimetype filter accepted the file based on client claims; the
      // content did not match. Delete the saved file and reject the upload.
      try {
        unlinkSync(req.file.path);
      } catch (err) {
        logger.warn("upload cleanup failed", { path: req.file.path, err });
      }
      res.status(400).json({ error: "pdf-content-mismatch" });
      return;
    }
    const documentDescription = normalizeOptionalText(req.body?.documentDescription);
    if (req.file.mimetype.startsWith("image/") && !documentDescription) {
      try {
        unlinkSync(req.file.path);
      } catch (err) {
        logger.warn("upload cleanup failed", { path: req.file.path, err });
      }
      res.status(400).json({ error: "document-description-required" });
      return;
    }
    const pdfUrl = `/uploads/${req.file.filename}`;
    const oldPdfUrl = session.pdfUrl;
    // A new document means a new song: reset to the top and pause so viewers
    // don't keep extrapolating the previous song's scroll position.
    const patch: Parameters<typeof updateSessionState>[1] = {
      pdfUrl,
      progress: 0,
      currentPage: 1,
      numPages: 0,
      playing: false,
    };
    if (documentDescription !== undefined || req.file.mimetype.startsWith("image/")) {
      patch.documentDescription = documentDescription;
    }
    const updated = updateSessionState(session.id, patch);
    if (updated) {
      if (oldPdfUrl && oldPdfUrl !== pdfUrl) {
        markerGenerationService.invalidateSuggestionsForSession(session.id);
      }
      await refreshSessionSharePreview(updated);
      broadcastSessionState(updated);
      broadcastSessionListUpdated();
      if (oldPdfUrl && oldPdfUrl !== pdfUrl) {
        removeObsoleteUpload(oldPdfUrl);
      }
    }
    res.json(updated);
  }
);

adminRouter.post("/sessions/:id/start", (req, res) => {
  const updated = updateSessionState(req.params.id, {
    status: "live",
    playing: true,
  });
  if (!updated) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(updated);
  broadcastSessionListUpdated();
  res.json(updated);
});

adminRouter.post("/sessions/:id/pause", (req, res) => {
  const updated = updateSessionState(req.params.id, { playing: false });
  if (!updated) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(updated);
  res.json(updated);
});

adminRouter.post("/sessions/:id/seek", (req, res) => {
  const progress = clampProgress(Number(req.body?.progress));
  const updated = updateSessionState(req.params.id, { progress });
  if (!updated) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(updated);
  res.json(updated);
});

adminRouter.post("/sessions/:id/speed", (req, res) => {
  const speed = Math.max(0, Number(req.body?.speed) || 0);
  const updated = updateSessionState(req.params.id, { speed });
  if (!updated) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(updated);
  res.json(updated);
});

adminRouter.post("/sessions/:id/end", (req, res) => {
  const ended = endSession(req.params.id);
  if (!ended) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(ended);
  broadcastSessionEnded(ended);
  broadcastSessionListUpdated();
  res.json(ended);
});

adminRouter.post("/sessions/:id/toggle-lock", (req, res) => {
  const updated = toggleSessionLock(req.params.id);
  if (!updated) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  broadcastSessionState(updated);
  broadcastSessionListUpdated();
  res.json(updated);
});

adminRouter.delete("/sessions/:id", (req, res) => {
  const session = getSessionById(req.params.id);
  if (session?.locked) {
    res.status(409).json({ error: "session-locked" });
    return;
  }
  if (session) {
    broadcastSessionEnded(session);
  }
  const ok = deleteSession(req.params.id);
  if (ok && session) {
    removeObsoleteUpload(session.pdfUrl);
    removeSessionSharePreview(session.code);
  }
  broadcastSessionListUpdated();
  res.json({ ok });
});
