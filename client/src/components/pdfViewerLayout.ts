export type VisiblePageRange = {
  start: number;
  end: number;
};

export type ScrollAnchor = {
  page: number;
  fraction: number;
};

export function scrollTopToAnchor(
  scrollTop: number,
  pageTops: readonly number[],
  pageHeights: readonly number[]
): ScrollAnchor | null {
  if (pageTops.length === 0 || pageHeights.length === 0) return null;
  const clampedTop = Math.max(0, scrollTop);
  let index = 0;
  for (let candidate = 1; candidate < pageTops.length; candidate += 1) {
    if (pageTops[candidate] > clampedTop) break;
    index = candidate;
  }
  const height = Math.max(1, pageHeights[index] ?? 1);
  return { page: index + 1, fraction: clamp01((clampedTop - pageTops[index]) / height) };
}

export function anchorToScrollTop(
  anchor: ScrollAnchor,
  pageTops: readonly number[],
  pageHeights: readonly number[],
  maxScrollPx: number
): number | null {
  const index = Math.round(anchor.page) - 1;
  const pageTop = pageTops[index];
  const pageHeight = pageHeights[index];
  if (index < 0 || pageTop === undefined || pageHeight === undefined) return null;
  return Math.min(Math.max(0, maxScrollPx), pageTop + clamp01(anchor.fraction) * pageHeight);
}

export function getReservedPageHeights(
  displayWidth: number,
  pageAspects: readonly number[]
): number[] {
  return pageAspects.map((aspect) =>
    Math.max(1, Math.round(displayWidth * normalizeAspect(aspect)))
  );
}

export function getEffectivePageHeights(
  predictedPageHeights: readonly number[],
  measuredPageHeights: readonly (number | null | undefined)[]
): number[] {
  return predictedPageHeights.map((height, index) => {
    const measuredHeight = measuredPageHeights[index];
    return measuredHeight != null && measuredHeight > 0 ? measuredHeight : height;
  });
}

export function getPageTopOffsets(
  pageHeights: readonly number[],
  pageTop: number,
  pageGap: number
): number[] {
  const offsets: number[] = [];
  let cursor = pageTop;

  for (let index = 0; index < pageHeights.length; index++) {
    offsets.push(cursor);
    cursor += pageHeights[index] + (index < pageHeights.length - 1 ? pageGap : 0);
  }

  return offsets;
}

export function getVisiblePageRange(
  scrollTop: number,
  clientHeight: number,
  pageTops: readonly number[],
  pageHeights: readonly number[],
  overscan: number
): VisiblePageRange {
  if (pageTops.length === 0 || pageHeights.length === 0) {
    return { start: 0, end: 0 };
  }

  const viewportTop = Math.max(0, scrollTop);
  const viewportBottom = viewportTop + Math.max(0, clientHeight);

  let start = 0;
  while (
    start < pageHeights.length - 1 &&
    pageTops[start] + pageHeights[start] < viewportTop
  ) {
    start += 1;
  }

  let end = start;
  while (end < pageHeights.length - 1 && pageTops[end + 1] <= viewportBottom) {
    end += 1;
  }

  return {
    start: Math.max(0, start - overscan),
    end: Math.min(pageHeights.length - 1, end + overscan),
  };
}

export function getSinglePageWidth(
  displayWidth: number,
  containerHeight: number,
  pageAspect: number | null,
  chromeFlush: boolean
): number {
  if (pageAspect == null || containerHeight <= 0) return displayWidth;

  const availableHeight = Math.max(1, containerHeight - (chromeFlush ? 0 : 24));
  return Math.max(
    280,
    Math.min(displayWidth, Math.floor(availableHeight / normalizeAspect(pageAspect)))
  );
}

function normalizeAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  return aspect;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
