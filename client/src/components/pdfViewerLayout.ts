export type VisiblePageRange = {
  start: number;
  end: number;
};

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
