import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionState } from "../types.js";
import type { DocumentGeometry } from "../types.js";
import { createDocumentGeometry } from "../lib/documentPosition.js";
import { env } from "../env.js";
import { extractUploadFilename } from "../uploads/cleanup.js";
import type { DocumentPageEvidence } from "./types.js";
import type { Canvas } from "@napi-rs/canvas";

type CanvasModule = typeof import("@napi-rs/canvas");
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const MAX_TEXT_EXCERPT = 1200;
const PDF_IMAGE_SCALE = 1.2;

let canvasModulePromise: Promise<CanvasModule> | undefined;
let pdfJsModulePromise: Promise<PdfJsModule> | undefined;

async function getCanvasModule(): Promise<CanvasModule> {
  canvasModulePromise ??= import("@napi-rs/canvas");
  return canvasModulePromise;
}

async function getPdfJsModule(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsModulePromise;
}

function standardFontDataUrl(): string {
  return `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`;
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function excerpt(text: string): string {
  return text.length <= MAX_TEXT_EXCERPT ? text : `${text.slice(0, MAX_TEXT_EXCERPT)}…`;
}

function fingerprintHeader(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  return createHash("sha1").update(firstLine.toLowerCase()).digest("hex").slice(0, 12);
}

function hasLargeTitleCandidate(text: string): boolean {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return false;
  return firstLine.length <= 80 && /\p{L}/u.test(firstLine);
}

function mediaTypeForPath(filePath: string): string {
  if (/\.png$/i.test(filePath)) return "image/png";
  if (/\.jpe?g$/i.test(filePath)) return "image/jpeg";
  if (/\.webp$/i.test(filePath)) return "image/webp";
  if (/\.gif$/i.test(filePath)) return "image/gif";
  if (/\.avif$/i.test(filePath)) return "image/avif";
  return "application/octet-stream";
}

function shouldRenderVisionPage(textDensity: number, page: number, hasTitle: boolean): boolean {
  if (page === 1) return true;
  if (textDensity < 80) return true;
  return hasTitle;
}

export function resolveUploadPath(session: SessionState): string {
  const filename = extractUploadFilename(session.pdfUrl);
  if (!filename) {
    throw new Error("missing-upload-filename");
  }
  return resolve(env.UPLOAD_DIR, filename);
}

export function createDocumentFingerprint(filePath: string): string {
  const stats = statSync(filePath);
  const digest = createHash("sha1");
  digest.update(filePath);
  digest.update(String(stats.size));
  digest.update(String(stats.mtimeMs));
  return digest.digest("hex");
}

/** Read the intrinsic PDF page heights once on upload. This is deliberately
 * server-side: clients must never define the coordinate system they follow. */
export async function readDocumentGeometry(filePath: string): Promise<DocumentGeometry | undefined> {
  if (IMAGE_RE.test(filePath)) return undefined;
  const { getDocument } = await getPdfJsModule();
  const data = new Uint8Array(readFileSync(filePath));
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
    verbosity: 0,
  } as never);
  const pdf = await loadingTask.promise;
  try {
    const heights: number[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const viewport = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
      heights.push(viewport.height);
    }
    return createDocumentGeometry(createDocumentFingerprint(filePath), heights);
  } finally {
    await loadingTask.destroy();
  }
}

export async function readSessionDocumentGeometry(session: SessionState): Promise<DocumentGeometry | undefined> {
  if (!session.pdfUrl || IMAGE_RE.test(session.pdfUrl)) return undefined;
  return readDocumentGeometry(resolveUploadPath(session));
}

async function renderPdfPageDataUrl(filePath: string, pageNumber: number): Promise<string> {
  const { createCanvas } = await getCanvasModule();
  const { getDocument } = await getPdfJsModule();
  const data = new Uint8Array(readFileSync(filePath));
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
    verbosity: 0,
  } as never);
  const pdf = await loadingTask.promise;
  let canvas: Canvas | undefined;

  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_IMAGE_SCALE });
    canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({
      canvasContext: context as never,
      viewport,
      canvas,
    }).promise;
    return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    await loadingTask.destroy();
  }
}

async function analyzePdf(filePath: string, documentDescription?: string): Promise<DocumentPageEvidence[]> {
  const { getDocument } = await getPdfJsModule();
  const data = new Uint8Array(readFileSync(filePath));
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
    verbosity: 0,
  } as never);
  const pdf = await loadingTask.promise;

  try {
    const pages: DocumentPageEvidence[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const rawText = normalizeText(
        textContent.items
          .map((item) => ("str" in item ? String(item.str ?? "") : ""))
          .join("\n")
      );
      const textExcerpt = excerpt(rawText);
      const textDensity = rawText.replace(/\s+/g, "").length;
      const titleCandidate = hasLargeTitleCandidate(rawText);
      pages.push({
        page: pageNumber,
        textExcerpt,
        textDensity,
        hasLargeTitleCandidate: titleCandidate,
        repeatedHeaderFingerprint: fingerprintHeader(rawText),
        imageAttached: false,
        documentDescription,
      });
    }

    for (const evidence of pages) {
      if (!shouldRenderVisionPage(evidence.textDensity, evidence.page, evidence.hasLargeTitleCandidate)) {
        continue;
      }
      evidence.imageDataUrl = await renderPdfPageDataUrl(filePath, evidence.page);
      evidence.imageAttached = true;
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

async function analyzeImage(filePath: string, documentDescription?: string): Promise<DocumentPageEvidence[]> {
  const mediaType = mediaTypeForPath(filePath);
  const dataUrl = `data:${mediaType};base64,${readFileSync(filePath).toString("base64")}`;
  return [
    {
      page: 1,
      textExcerpt: documentDescription?.trim() ?? "",
      textDensity: documentDescription?.trim().length ?? 0,
      hasLargeTitleCandidate: true,
      repeatedHeaderFingerprint: "",
      imageAttached: true,
      documentDescription,
      imageDataUrl: dataUrl,
    },
  ];
}

export async function analyzeSessionDocument(session: SessionState): Promise<{
  documentFingerprint: string;
  evidence: DocumentPageEvidence[];
}> {
  const filePath = resolveUploadPath(session);
  const documentFingerprint = createDocumentFingerprint(filePath);
  const evidence = IMAGE_RE.test(filePath)
    ? await analyzeImage(filePath, session.documentDescription)
    : await analyzePdf(filePath, session.documentDescription);
  return { documentFingerprint, evidence };
}
