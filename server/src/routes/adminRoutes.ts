import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { env } from "../env.js";
import { checkPassword, requireAdmin } from "../auth.js";
import {
  createSession,
  deleteSession,
  endSession,
  getSessionById,
  listAdminSessions,
  updateSessionState,
  clampProgress,
} from "../sessionStore.js";
import {
  broadcastSessionEnded,
  broadcastSessionListUpdated,
  broadcastSessionState,
} from "../sockets/socketServer.js";
import { removeObsoleteUpload } from "../uploads/cleanup.js";

export const adminRouter = Router();

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

// ---- Auth ----
adminRouter.post("/login", (req, res) => {
  if (!checkPassword(req.body?.password)) {
    res.status(401).json({ error: "invalid-password" });
    return;
  }
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

adminRouter.get("/sessions", (_req, res) => {
  res.json(listAdminSessions());
});

adminRouter.post("/sessions", (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "title-required" });
    return;
  }
  const session = createSession({
    title,
    description: req.body?.description ? String(req.body.description) : undefined,
  });
  broadcastSessionListUpdated();
  res.status(201).json(session);
});

adminRouter.get("/sessions/:id", (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  res.json(session);
});

adminRouter.post("/sessions/:id/pdf", upload.single("pdf"), (req, res) => {
  const session = getSessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session-not-found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "pdf-required-or-invalid" });
    return;
  }
  const pdfUrl = `/uploads/${req.file.filename}`;
  const oldPdfUrl = session.pdfUrl;
  // A new document means a new song: reset to the top and pause so viewers
  // don't keep extrapolating the previous song's scroll position.
  const updated = updateSessionState(session.id, {
    pdfUrl,
    progress: 0,
    playing: false,
  });
  if (updated) {
    broadcastSessionState(updated);
    broadcastSessionListUpdated();
    if (oldPdfUrl && oldPdfUrl !== pdfUrl) {
      removeObsoleteUpload(oldPdfUrl);
    }
  }
  res.json(updated);
});

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

adminRouter.delete("/sessions/:id", (req, res) => {
  const session = getSessionById(req.params.id);
  if (session) {
    broadcastSessionEnded(session);
  }
  const ok = deleteSession(req.params.id);
  if (ok && session) {
    removeObsoleteUpload(session.pdfUrl);
  }
  broadcastSessionListUpdated();
  res.json({ ok });
});
