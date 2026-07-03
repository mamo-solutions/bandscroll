import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureSessionStore,
  createSession,
  deleteSession,
  updateSessionState,
} from "../sessionStore.js";
import { MemorySessionStore } from "../store/memorySessionStore.js";
import {
  extractServedFilename,
  extractUploadFilename,
  removeObsoleteUpload,
} from "./cleanup.js";

// Each test gets a fresh in-memory store and temp upload dir.
describe("upload cleanup", () => {
  let uploadDir: string;

  beforeEach(() => {
    configureSessionStore(new MemorySessionStore());
    uploadDir = mkdtempSync(join(tmpdir(), "bandscroll-cleanup-"));
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  function touch(filename: string): string {
    const path = join(uploadDir, filename);
    writeFileSync(path, "pdf-content");
    return `/uploads/${filename}`;
  }

  it("extracts upload filenames", () => {
    expect(extractUploadFilename("/uploads/abc.pdf")).toBe("abc.pdf");
    expect(extractServedFilename("/share-previews/SESSION-1234.png", "/share-previews/")).toBe(
      "SESSION-1234.png"
    );
    expect(extractUploadFilename(undefined)).toBeUndefined();
    expect(extractUploadFilename("https://example.com/file.pdf")).toBeUndefined();
    expect(extractUploadFilename("/other/abc.pdf")).toBeUndefined();
  });

  it("removes an unreferenced upload file", () => {
    const pdfUrl = touch("orphan.pdf");
    expect(existsSync(join(uploadDir, "orphan.pdf"))).toBe(true);

    removeObsoleteUpload(pdfUrl, uploadDir);

    expect(existsSync(join(uploadDir, "orphan.pdf"))).toBe(false);
  });

  it("keeps files still referenced by another session", () => {
    const pdfUrl = touch("shared.pdf");
    const keeper = createSession({ title: "Keeper", pdfUrl });
    const goner = createSession({ title: "Goner", pdfUrl });

    deleteSession(goner.id);
    removeObsoleteUpload(pdfUrl, uploadDir);

    expect(existsSync(join(uploadDir, "shared.pdf"))).toBe(true);
    expect(keeper.pdfUrl).toBe(pdfUrl);
  });

  it("removes the old file when a session swaps PDFs", () => {
    const oldUrl = touch("old.pdf");
    const newUrl = touch("new.pdf");
    const session = createSession({ title: "Swap", pdfUrl: oldUrl });

    updateSessionState(session.id, { pdfUrl: newUrl });
    removeObsoleteUpload(oldUrl, uploadDir);

    expect(existsSync(join(uploadDir, "old.pdf"))).toBe(false);
    expect(existsSync(join(uploadDir, "new.pdf"))).toBe(true);
  });

  it("does nothing for non-upload URLs", () => {
    expect(() =>
      removeObsoleteUpload("https://example.com/file.pdf", uploadDir)
    ).not.toThrow();
  });

  it("does nothing when the file is already gone", () => {
    expect(() => removeObsoleteUpload("/uploads/missing.pdf", uploadDir)).not.toThrow();
  });
});
