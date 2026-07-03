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

/** Start page of the next song after `currentPage`: the lowest marker page
 *  strictly greater than `currentPage`, or null when none exists. */
export function nextSongStartPage(
  markers: SessionState["markers"],
  currentPage: number
): number | null {
  let best: number | null = null;
  for (const marker of markers) {
    if (marker.page > currentPage && (best === null || marker.page < best)) {
      best = marker.page;
    }
  }
  return best;
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

    // Auto-stop at song end: if this tick would advance into the next song,
    // halt on that song's first page. Only natural tick advancement reaches
    // here (manual page jumps use admin-set-page), so seeks never false-trigger.
    if (session.autoStopAtSongEnd) {
      const boundary = nextSongStartPage(session.markers, session.currentPage);
      if (boundary !== null && nextPage >= boundary) {
        const patch = {
          progress: pageStartProgress(boundary, session.numPages),
          currentPage: boundary,
          playing: false,
        };
        return patch.progress === session.progress &&
          patch.currentPage === session.currentPage &&
          patch.playing === session.playing
          ? null
          : patch;
      }
    }

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
