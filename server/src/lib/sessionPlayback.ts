import type { SessionState } from "../types.js";

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function pageForProgress(progress: number, numPages: number): number {
  if (numPages <= 1) return 1;
  return Math.min(numPages, Math.floor(clamp01(progress) * numPages) + 1);
}

export function pageStartProgress(page: number, numPages: number): number {
  if (numPages <= 0) return 0;
  return clamp01((Math.max(1, Math.min(page, numPages)) - 1) / numPages);
}

export function nextPlaybackPatch(
  session: SessionState,
  now = Date.now()
): Pick<SessionState, "progress" | "currentPage" | "playing"> | null {
  if (!session.playing) return null;

  const elapsedSec = Math.max(0, (now - session.updatedAt) / 1000);
  const nextProgress = clamp01(session.progress + elapsedSec * session.speed);

  if (session.playbackMode === "page") {
    if (session.numPages <= 0 || session.speed <= 0) return null;

    const nextPage = pageForProgress(nextProgress, session.numPages);
    if (nextPage >= session.numPages) {
      const patch = {
        progress: pageStartProgress(session.numPages, session.numPages),
        currentPage: session.numPages,
        playing: false,
      };
      return patch.progress === session.progress &&
        patch.currentPage === session.currentPage &&
        patch.playing === session.playing
        ? null
        : patch;
    }

    const patch = {
      progress: nextProgress,
      currentPage: nextPage,
      playing: true,
    };
    return patch.progress === session.progress &&
      patch.currentPage === session.currentPage &&
      patch.playing === session.playing
      ? null
      : patch;
  }

  const patch = {
    progress: nextProgress,
    currentPage: session.currentPage,
    playing: nextProgress >= 1 ? false : session.playing,
  };
  return patch.progress === session.progress &&
    patch.currentPage === session.currentPage &&
    patch.playing === session.playing
    ? null
    : patch;
}
