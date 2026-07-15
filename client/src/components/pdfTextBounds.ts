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
