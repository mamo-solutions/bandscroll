import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateUploadFile } from "./validate.js";

describe("validateUploadFile", () => {
  function write(name: string, data: Uint8Array | string): string {
    const dir = mkdtempSync(join(tmpdir(), "bandscroll-validate-"));
    const path = join(dir, name);
    writeFileSync(path, data);
    return path;
  }

  it("accepts a real PDF signature", () => {
    const path = write("doc.pdf", "%PDF-1.4\n1 0 obj\n");
    expect(validateUploadFile(path, "application/pdf")).toBe(true);
    rmSync(path, { force: true });
  });

  it("rejects HTML renamed to PDF", () => {
    const path = write("evil.pdf", "<html><script>alert(1)</script></html>");
    expect(validateUploadFile(path, "application/pdf")).toBe(false);
    rmSync(path, { force: true });
  });

  it("accepts PNG and rejects PNG mimetype on HTML", () => {
    const png = write("img.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(validateUploadFile(png, "image/png")).toBe(true);
    rmSync(png, { force: true });

    const html = write("img.png", "<html></html>");
    expect(validateUploadFile(html, "image/png")).toBe(false);
    rmSync(html, { force: true });
  });

  it("accepts JPEG signatures", () => {
    const path = write("img.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(validateUploadFile(path, "image/jpeg")).toBe(true);
    rmSync(path, { force: true });
  });

  it("accepts WebP signatures", () => {
    const path = write("img.webp", "RIFF\x00\x00\x00\x00WEBPVP8 ");
    expect(validateUploadFile(path, "image/webp")).toBe(true);
    rmSync(path, { force: true });
  });

  it("accepts GIF signatures", () => {
    const path = write("img.gif", "GIF89a\x01\x00");
    expect(validateUploadFile(path, "image/gif")).toBe(true);
    rmSync(path, { force: true });
  });

  it("rejects unknown mimetypes", () => {
    const path = write("file.txt", "hello");
    expect(validateUploadFile(path, "text/plain")).toBe(false);
    rmSync(path, { force: true });
  });

  it("rejects missing files", () => {
    expect(validateUploadFile(join(tmpdir(), "missing.pdf"), "application/pdf")).toBe(false);
  });
});
