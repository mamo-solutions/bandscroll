import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env.js";
import { listAdminSessions } from "../sessionStore.js";

/** Extract the filename from an `/uploads/:file` URL, if present. */
export function extractUploadFilename(pdfUrl: string | undefined): string | undefined {
  if (!pdfUrl || !pdfUrl.startsWith("/uploads/")) return undefined;
  return pdfUrl.slice("/uploads/".length);
}

/**
 * Remove an upload file when no remaining session references it.
 * Safe to call for non-upload URLs, missing files, or URLs still in use.
 */
export function removeObsoleteUpload(
  pdfUrl: string | undefined,
  uploadDir: string = env.UPLOAD_DIR
): void {
  const filename = extractUploadFilename(pdfUrl);
  if (!filename) return;

  const stillReferenced = listAdminSessions().some((s) => s.pdfUrl === pdfUrl);
  if (stillReferenced) return;

  const filePath = resolve(uploadDir, filename);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}
