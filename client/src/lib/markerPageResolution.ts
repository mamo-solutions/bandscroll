import type { SongMarker } from "@/types/session";

type MarkerPageLookup = (
  title: string,
  minimumPage: number,
  maximumPage?: number
) => Promise<number | null>;

function clampMarkerPage(page: number, numPages: number): number {
  return Math.max(1, Math.min(numPages, Math.round(page)));
}

function fillMissingPages(
  pages: Array<number | null>,
  markers: SongMarker[],
  numPages: number
): number[] {
  const filled = pages.slice();
  let index = 0;

  while (index < filled.length) {
    if (filled[index] !== null) {
      index += 1;
      continue;
    }

    const start = index;
    while (index < filled.length && filled[index] === null) index += 1;
    const end = index - 1;
    const missingCount = end - start + 1;
    const previousPage = start > 0 ? filled[start - 1] ?? 0 : 0;
    const nextPage = index < filled.length ? filled[index] ?? numPages + 1 : numPages + 1;
    const availableGap = Math.max(0, nextPage - previousPage - 1);

    if (availableGap >= missingCount) {
      let lastAssigned = previousPage;
      for (let offset = 1; offset <= missingCount; offset += 1) {
        const suggested = previousPage + Math.round((offset * (nextPage - previousPage)) / (missingCount + 1));
        const maxAllowed = nextPage - (missingCount - offset + 1);
        const assigned = Math.max(lastAssigned + 1, Math.min(maxAllowed, suggested));
        filled[start + offset - 1] = clampMarkerPage(assigned, numPages);
        lastAssigned = assigned;
      }
      continue;
    }

    let lastAssigned = previousPage;
    for (let offset = 0; offset < missingCount; offset += 1) {
      const fallback = Math.max(lastAssigned + 1, clampMarkerPage(markers[start + offset].page, numPages));
      filled[start + offset] = clampMarkerPage(fallback, numPages);
      lastAssigned = filled[start + offset] ?? lastAssigned;
    }
  }

  return filled.map((page, index) => clampMarkerPage(page ?? markers[index].page, numPages));
}

export async function resolveMarkerPages(
  markers: SongMarker[],
  numPages: number,
  lookupPage: MarkerPageLookup
): Promise<SongMarker[]> {
  if (markers.length === 0 || numPages <= 0) return markers;

  const sorted = markers.slice().sort((a, b) => a.page - b.page);
  const resolvedPages: Array<number | null> = [];
  let previousResolvedPage = 0;

  for (const [index, marker] of sorted.entries()) {
    const minimumPage = clampMarkerPage(
      Math.max(previousResolvedPage + 1, marker.page - (index === 0 ? 1 : 0)),
      numPages
    );
    const resolvedPage = await lookupPage(marker.title, minimumPage);
    resolvedPages.push(resolvedPage === null ? null : clampMarkerPage(resolvedPage, numPages));
    if (resolvedPage !== null) previousResolvedPage = clampMarkerPage(resolvedPage, numPages);
  }

  const filledPages = fillMissingPages(resolvedPages, sorted, numPages);
  return sorted.map((marker, index) => ({
    ...marker,
    page: filledPages[index],
  }));
}
