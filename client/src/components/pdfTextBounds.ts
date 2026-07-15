export type PdfTextItemLike = {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
};

export type PdfViewportLike = {
  height: number;
  convertToViewportRectangle: (rect: number[]) => number[];
};

export type SongEndProgressInput = {
  pageTopPx: number;
  textBottomInPagePx: number;
  viewportHeightPx: number;
  maxScrollPx: number;
  bottomBufferFraction: number;
};

/** Returns the lowest rendered text edge on one PDF page, in CSS pixels. */
export function getTextBottomInPagePx(
  items: readonly PdfTextItemLike[],
  viewport: PdfViewportLike,
  renderedPageHeightPx: number
): number | null {
  if (!Number.isFinite(viewport.height) || viewport.height <= 0 || renderedPageHeightPx <= 0) {
    return null;
  }

  const cssScale = renderedPageHeightPx / viewport.height;
  let lowestBottom: number | null = null;

  for (const item of items) {
    if (!item.str.trim() || item.transform.length < 6 || item.width < 0 || item.height <= 0) {
      continue;
    }

    const rectangle = transformTextRectangle(item);
    if (!rectangle) continue;
    const viewportRectangle = viewport.convertToViewportRectangle(rectangle);
    if (viewportRectangle.length < 4 || viewportRectangle.some((value) => !Number.isFinite(value))) {
      continue;
    }

    const bottom = Math.max(viewportRectangle[1], viewportRectangle[3]) * cssScale;
    lowestBottom = lowestBottom === null ? bottom : Math.max(lowestBottom, bottom);
  }

  return lowestBottom;
}

/** Places the final text at the requested fraction of the viewport height. */
export function getSongEndProgress({
  pageTopPx,
  textBottomInPagePx,
  viewportHeightPx,
  maxScrollPx,
  bottomBufferFraction,
}: SongEndProgressInput): number | null {
  if (
    !Number.isFinite(pageTopPx) ||
    !Number.isFinite(textBottomInPagePx) ||
    !Number.isFinite(viewportHeightPx) ||
    !Number.isFinite(maxScrollPx) ||
    maxScrollPx <= 0
  ) {
    return null;
  }

  const visibleHeight = viewportHeightPx * clamp01(1 - bottomBufferFraction);
  return clamp01((pageTopPx + textBottomInPagePx - visibleHeight) / maxScrollPx);
}

/** Returns the lowest dark foreground pixel on a rasterized page. */
export function getDarkPixelBottomFraction(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): number | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return null;

  const background = getCornerLuminance(pixels, width, height);
  const threshold = background >= 128 ? background - 40 : background + 40;
  let lowestRow = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < 32) continue;
      const luminance = getLuminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      const isForeground = background >= 128 ? luminance <= threshold : luminance >= threshold;
      if (isForeground) lowestRow = y;
    }
  }

  return lowestRow < 0 ? null : (lowestRow + 1) / height;
}

function transformTextRectangle(item: PdfTextItemLike): [number, number, number, number] | null {
  const [a, b, c, d, e, f] = item.transform;
  if (![a, b, c, d, e, f, item.width, item.height].every(Number.isFinite)) return null;

  const corners = [
    transformPoint(a, b, c, d, e, f, 0, 0),
    transformPoint(a, b, c, d, e, f, item.width, 0),
    transformPoint(a, b, c, d, e, f, 0, item.height),
    transformPoint(a, b, c, d, e, f, item.width, item.height),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function transformPoint(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  x: number,
  y: number
): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function getCornerLuminance(pixels: Uint8ClampedArray, width: number, height: number): number {
  const corners = [0, width - 1, (height - 1) * width, width * height - 1];
  return (
    corners.reduce((sum, pixelIndex) => {
      const offset = pixelIndex * 4;
      return sum + getLuminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    }, 0) / corners.length
  );
}

function getLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
