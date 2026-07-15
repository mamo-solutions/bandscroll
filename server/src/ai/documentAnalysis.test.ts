import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeSessionDocument } from "./documentAnalysis.js";
import type { SessionState } from "../types.js";
import { env } from "../env.js";

const dirs: string[] = [];

function makePdfBytes(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 48 >>\nstream\nBT /F1 24 Tf 48 120 Td (Amazing Grace) Tj ET\nendstream",
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

  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("analyzeSessionDocument", () => {
  it("extracts ordered page evidence from a pdf upload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bandscroll-analysis-"));
    dirs.push(dir);
    const filePath = join(dir, "song.pdf");
    writeFileSync(filePath, makePdfBytes());

    const session: SessionState = {
      id: "s1",
      code: "SESSION-1000",
      title: "Test",
      pdfUrl: `/uploads/${filePath.split("/").pop()}`,
      status: "draft",
      playing: false,
      progress: 0,
      speed: 0.0002,
      updatedAt: Date.now(),
      connectedClients: 0,
      createdAt: Date.now(),
      markers: [],
      locked: false,
      playbackMode: "scroll",
      backgroundMode: "light",
      autoStopAtSongEnd: false,
      currentPage: 1,
      numPages: 0,
      stateVersion: 0,
    };

    const originalUploadDir = env.UPLOAD_DIR;
    env.UPLOAD_DIR = dir;
    try {
      const result = await analyzeSessionDocument(session);
      expect(result.documentFingerprint).toHaveLength(40);
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].page).toBe(1);
      expect(result.evidence[0].textExcerpt).toContain("Amazing Grace");
    } finally {
      env.UPLOAD_DIR = originalUploadDir;
    }
  });
});
