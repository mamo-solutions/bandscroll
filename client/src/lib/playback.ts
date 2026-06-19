import { clamp01, type PlaybackMode } from "../types/session";

export function getPlaybackDisplayProgress(
  playbackMode: PlaybackMode,
  progress: number,
  currentPage: number,
  numPages: number
): number {
  if (playbackMode === "page") return pageToDisplayProgress(currentPage, numPages);
  return clamp01(progress);
}

export function pageToDisplayProgress(page: number, numPages: number): number {
  if (numPages <= 1) return numPages === 1 ? 1 : 0;
  const clampedPage = clampPage(page, numPages);
  return (clampedPage - 1) / (numPages - 1);
}

export function progressToNearestPage(progress: number, numPages: number): number {
  if (numPages <= 1) return 1;
  return Math.round(clamp01(progress) * (numPages - 1)) + 1;
}

export function clampPage(page: number, numPages: number): number {
  if (!Number.isFinite(page)) return 1;
  if (numPages <= 1) return 1;
  return Math.min(numPages, Math.max(1, Math.round(page)));
}

export function getPageDwellMs(speed: number, numPages: number): number | null {
  if (speed <= 0 || numPages <= 0) return null;
  return ((1 / numPages) / speed) * 1000;
}
