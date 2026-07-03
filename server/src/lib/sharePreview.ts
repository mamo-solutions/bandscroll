import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { env } from "../env.js";
import { logger } from "./logger.js";
import { extractServedFilename, extractUploadFilename } from "../uploads/cleanup.js";
import type { SessionState } from "../types.js";

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const CARD_RADIUS = 30;
const HERO_X = 56;
const HERO_Y = 56;
const HERO_WIDTH = 640;
const HERO_HEIGHT = 518;
const HERO_PLACEHOLDER_TEXT = "Preview unavailable";

type PreviewImage = Awaited<ReturnType<typeof loadImage>>;

function ensureSharePreviewDir(previewDir: string = env.SHARE_PREVIEW_DIR): void {
  if (!existsSync(previewDir)) {
    mkdirSync(previewDir, { recursive: true });
  }
}

function baseUrl(baseUrl: string = env.PUBLIC_BASE_URL): string {
  return baseUrl.replace(/\/$/, "");
}

function standardFontDataUrl(): string {
  return `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`;
}

function previewFileName(code: string): string {
  return `${code}.png`;
}

function previewFilePath(code: string, previewDir: string = env.SHARE_PREVIEW_DIR): string {
  return resolve(previewDir, previewFileName(code));
}

function tempPreviewFilePath(code: string, previewDir: string = env.SHARE_PREVIEW_DIR): string {
  return `${previewFilePath(code, previewDir)}.tmp`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function coverRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function containRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

async function renderPdfFirstPage(uploadPath: string): Promise<Buffer> {
  const data = new Uint8Array(readFileSync(uploadPath));
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
    verbosity: 0,
  } as any);
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context as never,
      viewport,
      canvas,
    }).promise;

    return canvas.toBuffer("image/png");
  } finally {
    await loadingTask.destroy();
  }
}

async function renderSourceImage(
  session: SessionState,
  uploadPath: string
): Promise<PreviewImage | undefined> {
  const uploadFilename = extractUploadFilename(session.pdfUrl);
  if (!uploadFilename) {
    throw new Error("missing-upload-filename");
  }

  try {
    if (uploadFilename.toLowerCase().endsWith(".pdf")) {
      const pageImage = await renderPdfFirstPage(uploadPath);
      return await loadImage(pageImage);
    }

    return await loadImage(uploadPath);
  } catch (err) {
    logger.warn("share preview source rendering failed; using fallback art", {
      sessionId: session.id,
      code: session.code,
      pdfUrl: session.pdfUrl,
      uploadPath,
      err,
    });
    return undefined;
  }
}

function drawFallbackHero(ctx: SKRSContext2D): void {
  const gradient = ctx.createLinearGradient(HERO_X, HERO_Y, HERO_X + HERO_WIDTH, HERO_Y + HERO_HEIGHT);
  gradient.addColorStop(0, "#f3d9c4");
  gradient.addColorStop(0.5, "#ecd4ba");
  gradient.addColorStop(1, "#d7ddcd");
  ctx.fillStyle = gradient;
  ctx.fillRect(HERO_X, HERO_Y, HERO_WIDTH, HERO_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#8f6d5d";
  ctx.beginPath();
  ctx.arc(HERO_X + 154, HERO_Y + 146, 118, 0, Math.PI * 2);
  ctx.arc(HERO_X + 520, HERO_Y + 410, 144, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#6b574e";
  ctx.font = "600 22px sans-serif";
  ctx.fillText(HERO_PLACEHOLDER_TEXT, HERO_X + 34, HERO_Y + HERO_HEIGHT - 46);
}

function drawPreviewFrame(
  ctx: SKRSContext2D,
  session: SessionState,
  image?: PreviewImage
): void {
  const backgroundGradient = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  backgroundGradient.addColorStop(0, "#fdf8f3");
  backgroundGradient.addColorStop(0.55, "#f7e3d6");
  backgroundGradient.addColorStop(1, "#d8dfcf");
  ctx.fillStyle = backgroundGradient;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  if (image) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    const backdrop = coverRect(image.width, image.height, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    ctx.drawImage(image, backdrop.x, backdrop.y, backdrop.width, backdrop.height);
    ctx.restore();
  }

  ctx.fillStyle = "rgba(41, 24, 18, 0.12)";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  ctx.save();
  roundedRect(ctx, HERO_X, HERO_Y, HERO_WIDTH, HERO_HEIGHT, CARD_RADIUS);
  ctx.clip();
  ctx.fillStyle = "#efe7dd";
  ctx.fillRect(HERO_X, HERO_Y, HERO_WIDTH, HERO_HEIGHT);
  if (image) {
    const hero = containRect(image.width, image.height, HERO_WIDTH, HERO_HEIGHT);
    ctx.drawImage(image, HERO_X + hero.x, HERO_Y + hero.y, hero.width, hero.height);
  } else {
    drawFallbackHero(ctx);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  roundedRect(ctx, HERO_X, HERO_Y, HERO_WIDTH, HERO_HEIGHT, CARD_RADIUS);
  ctx.stroke();

  const panelX = 744;
  const panelY = 68;
  const panelWidth = 398;
  const panelHeight = 494;
  ctx.fillStyle = "rgba(255, 251, 247, 0.92)";
  roundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 28);
  ctx.fill();

  ctx.fillStyle = "#5f4c43";
  ctx.font = "600 24px sans-serif";
  ctx.fillText("BandScroll", panelX + 30, panelY + 52);

  ctx.fillStyle = "#7f6f67";
  ctx.font = "600 17px sans-serif";
  ctx.fillText(session.code, panelX + 30, panelY + 92);

  ctx.fillStyle = "#241714";
  ctx.font = "700 52px sans-serif";
  drawWrappedText(ctx, session.title || "Untitled session", panelX + 30, panelY + 162, 338, 60, 4);

  const description = session.description?.trim() ?? "";
  if (description) {
    ctx.fillStyle = "#6f625c";
    ctx.font = "400 24px sans-serif";
    drawWrappedText(ctx, description, panelX + 30, panelY + 372, 330, 34, 3);
  }

  ctx.fillStyle = "#b95c40";
  roundedRect(ctx, panelX + 30, panelY + 410, 186, 58, 18);
  ctx.fill();

  ctx.fillStyle = "#fffaf5";
  ctx.font = "700 24px sans-serif";
  ctx.fillText("Open Session", panelX + 54, panelY + 447);
}

function drawWrappedText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): void {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  const lines: string[] = [];
  let current = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const next = `${current} ${words[index]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[index];
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines) {
    lines.push(current);
  }

  const remainingWords = words.slice(lines.join(" ").split(/\s+/).filter(Boolean).length);
  if (remainingWords.length > 0 && lines.length > 0) {
    const lastLine = `${lines.at(-1)} ${remainingWords.join(" ")}`.trim();
    lines[lines.length - 1] = ellipsizeText(ctx, lastLine, maxWidth);
  }

  lines.slice(0, maxLines).forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function ellipsizeText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return `${trimmed}…`;
}

function previewVersion(session: SessionState): string {
  const uploadFilename = extractUploadFilename(session.pdfUrl) ?? "none";
  return hashString(`${uploadFilename}:${session.title}`);
}

export function sessionSharePreviewUrl(
  session: SessionState,
  absoluteBaseUrl: string = env.PUBLIC_BASE_URL
): string {
  const root = baseUrl(absoluteBaseUrl);
  const version = previewVersion(session);
  return `${root}/share-previews/${encodeURIComponent(session.code)}.png?v=${version}`;
}

export function hasSharePreview(
  session: SessionState,
  previewDir: string = env.SHARE_PREVIEW_DIR
): boolean {
  return existsSync(previewFilePath(session.code, previewDir));
}

export async function generateSessionSharePreview(
  session: SessionState,
  uploadDir: string = env.UPLOAD_DIR,
  previewDir: string = env.SHARE_PREVIEW_DIR
): Promise<boolean> {
  if (!session.pdfUrl) return false;

  const uploadFilename = extractUploadFilename(session.pdfUrl);
  if (!uploadFilename) return false;

  const uploadPath = resolve(uploadDir, uploadFilename);
  ensureSharePreviewDir(previewDir);

  const image = await renderSourceImage(session, uploadPath);
  const canvas = createCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const ctx = canvas.getContext("2d");
  drawPreviewFrame(ctx, session, image);

  const tempPath = tempPreviewFilePath(session.code, previewDir);
  const finalPath = previewFilePath(session.code, previewDir);
  writeFileSync(tempPath, canvas.toBuffer("image/png"));
  writeFileSync(finalPath, readFileSync(tempPath));
  rmSync(tempPath, { force: true });
  return true;
}

export async function refreshSessionSharePreview(
  session: SessionState,
  uploadDir: string = env.UPLOAD_DIR,
  previewDir: string = env.SHARE_PREVIEW_DIR
): Promise<void> {
  if (!session.pdfUrl) {
    removeSessionSharePreview(session.code, previewDir);
    return;
  }

  try {
    const created = await generateSessionSharePreview(session, uploadDir, previewDir);
    if (!created) {
      removeSessionSharePreview(session.code, previewDir);
    }
  } catch (err) {
    removeSessionSharePreview(session.code, previewDir);
    logger.warn("share preview generation failed", {
      sessionId: session.id,
      code: session.code,
      pdfUrl: session.pdfUrl,
      err,
    });
  }
}

export function removeSessionSharePreview(
  code: string,
  previewDir: string = env.SHARE_PREVIEW_DIR
): void {
  const filePath = previewFilePath(code, previewDir);
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

export function previewPathForPublicUrl(
  publicUrl: string,
  previewDir: string = env.SHARE_PREVIEW_DIR
): string | undefined {
  const filename = extractServedFilename(publicUrl, "/share-previews/");
  if (!filename) return undefined;
  return resolve(previewDir, filename);
}
