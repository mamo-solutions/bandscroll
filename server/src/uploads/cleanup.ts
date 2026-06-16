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

  // Because this process is single-threaded and both the reference check and
  // delete are synchronous, no other event can create a new reference between
  // the two operations. The check is kept as a guard against manual state edits.
  const stillReferenced = listAdminSessions().some((s) => s.pdfUrl === pdfUrl);
  if (stillReferenced) return;

  const filePath = resolve(uploadDir, filename);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}
