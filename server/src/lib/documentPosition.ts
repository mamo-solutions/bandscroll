import type { DocumentCursor, DocumentGeometry } from "../types.js";

export const MICRO_POINTS_PER_POINT = 1_000;

export function createDocumentGeometry(revision: string, pageHeightsPoints: number[]): DocumentGeometry {
  const heights = pageHeightsPoints.map((height) => Math.max(0, Number(height) || 0));
  return {
    revision,
    pageHeightsPoints: heights,
    totalHeightPoints: heights.reduce((total, height) => total + height, 0),
  };
}

export function maxCursorMicroPoints(geometry: DocumentGeometry | undefined): number {
  return Math.max(0, Math.round((geometry?.totalHeightPoints ?? 0) * MICRO_POINTS_PER_POINT));
}

export function clampDocumentCursor(
  cursor: DocumentCursor | undefined,
  geometry: DocumentGeometry | undefined
): DocumentCursor | undefined {
  if (!cursor || !geometry || cursor.revision !== geometry.revision) return undefined;
  return {
    revision: geometry.revision,
    yMicroPoints: Math.min(maxCursorMicroPoints(geometry), Math.max(0, Math.round(cursor.yMicroPoints))),
  };
}

export function advanceDocumentCursor(
  cursor: DocumentCursor,
  geometry: DocumentGeometry,
  velocityPointsPerSecond: number,
  elapsedMilliseconds: number
): DocumentCursor {
  const elapsedSeconds = Math.max(0, elapsedMilliseconds) / 1_000;
  return clampDocumentCursor(
    {
      revision: cursor.revision,
      yMicroPoints: cursor.yMicroPoints + Math.round(velocityPointsPerSecond * elapsedSeconds * MICRO_POINTS_PER_POINT),
    },
    geometry
  ) ?? { revision: geometry.revision, yMicroPoints: 0 };
}

export function pageForDocumentCursor(cursor: DocumentCursor, geometry: DocumentGeometry): number {
  let position = cursor.yMicroPoints / MICRO_POINTS_PER_POINT;
  for (let index = 0; index < geometry.pageHeightsPoints.length; index += 1) {
    const height = geometry.pageHeightsPoints[index];
    if (position < height || index === geometry.pageHeightsPoints.length - 1) return index + 1;
    position -= height;
  }
  return 1;
}

export function cursorAtPageStart(page: number, geometry: DocumentGeometry): DocumentCursor {
  const index = Math.max(0, Math.min(geometry.pageHeightsPoints.length - 1, Math.round(page) - 1));
  const before = geometry.pageHeightsPoints.slice(0, index).reduce((sum, height) => sum + height, 0);
  return { revision: geometry.revision, yMicroPoints: Math.round(before * MICRO_POINTS_PER_POINT) };
}
