import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  generateSessionSharePreview,
  previewPathForPublicUrl,
  removeSessionSharePreview,
  sessionSharePreviewUrl,
} from "./sharePreview.js";
import type { SessionState } from "../types.js";

function makePngBytes(): Buffer {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7c38a";
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = "#7e3f2d";
  ctx.fillRect(6, 6, 20, 20);
  return canvas.toBuffer("image/png");
}

function makePdfBytes(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 43 >>\nstream\nBT /F1 24 Tf 48 120 Td (BandScroll) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n 
`;
  });
  pdf += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF`;

  return Buffer.from(pdf, "utf8");
}

function makeSession(pdfUrl: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-1",
    code: "SESSION-1234",
    title: "Preview Test",
    description: "Test session",
    documentDescription: "Lead sheet",
    pdfUrl,
    status: "draft",
    playing: false,
    progress: 0,
    speed: 0,
    updatedAt: 0,
    connectedClients: 0,
    createdAt: 0,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 0,
    stateVersion: 0,
    ...overrides,
  };
}

describe("share preview generation", () => {
  let uploadDir: string;
  let previewDir: string;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "bandscroll-share-upload-"));
    previewDir = mkdtempSync(join(tmpdir(), "bandscroll-share-preview-"));
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(previewDir, { recursive: true, force: true });
  });

  it("creates a preview image from an uploaded image", async () => {
    const uploadName = "cover.png";
    const png = makePngBytes();
    writeFileSync(join(uploadDir, uploadName), png);
    const session = makeSession(`/uploads/${uploadName}`);

    const created = await generateSessionSharePreview(session, uploadDir, previewDir);

    expect(created).toBe(true);
    expect(existsSync(join(previewDir, "SESSION-1234.png"))).toBe(true);
    expect(readFileSync(join(previewDir, "SESSION-1234.png")).subarray(0, 8)).toEqual(
      png.subarray(0, 8)
    );
  });

  it("creates a preview image from the first page of a PDF", async () => {
    const uploadName = "score.pdf";
    writeFileSync(join(uploadDir, uploadName), makePdfBytes());
    const session = makeSession(`/uploads/${uploadName}`);

    const created = await generateSessionSharePreview(session, uploadDir, previewDir);

    expect(created).toBe(true);
    expect(existsSync(join(previewDir, "SESSION-1234.png"))).toBe(true);
    expect(readFileSync(join(previewDir, "SESSION-1234.png")).subarray(0, 8)).toEqual(
      makePngBytes().subarray(0, 8)
    );
  });

  it("falls back to a branded preview when PDF rendering fails", async () => {
    const uploadName = "broken.pdf";
    writeFileSync(join(uploadDir, uploadName), Buffer.from("not-a-real-pdf", "utf8"));
    const session = makeSession(`/uploads/${uploadName}`);

    const created = await generateSessionSharePreview(session, uploadDir, previewDir);
    const previewBytes = readFileSync(join(previewDir, "SESSION-1234.png"));

    expect(created).toBe(true);
    expect(existsSync(join(previewDir, "SESSION-1234.png"))).toBe(true);
    expect(previewBytes.subarray(0, 8)).toEqual(makePngBytes().subarray(0, 8));
    expect(previewBytes.byteLength).toBeGreaterThan(1024);
  });

  it("builds a stable preview url and resolves public paths", () => {
    const session = makeSession("/uploads/score.pdf");
    const url = sessionSharePreviewUrl(session, "https://example.com");

    expect(url).toMatch(/^https:\/\/example\.com\/share-previews\/SESSION-1234\.png\?v=/);
    expect(previewPathForPublicUrl("/share-previews/SESSION-1234.png", previewDir)).toBe(
      join(previewDir, "SESSION-1234.png")
    );
  });

  it("removes a generated preview", () => {
    const filePath = join(previewDir, "SESSION-1234.png");
    writeFileSync(filePath, makePngBytes());

    removeSessionSharePreview("SESSION-1234", previewDir);

    expect(existsSync(filePath)).toBe(false);
  });
});
