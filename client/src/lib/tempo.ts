// Pure tap-tempo math, extracted from PlaybackControls so it can be unit-tested
// without rendering React. The component owns the tap timing/state; these
// functions are the deterministic core that turns taps into a scroll speed.

/** Scroll speed bounds (progress/second across the whole document). */
export const SPEED_MIN = 0.00001;
export const SPEED_MAX = 0.25;
export const DEFAULT_SCROLL_SCREENS_PER_MINUTE = 7;

/** Canonical PDF document speeds. These values never depend on a viewport. */
export const DOCUMENT_SPEED_PRESETS = [12, 24, 36, 48] as const;
export const DOCUMENT_SPEED_DEFAULT = 36;
export const DOCUMENT_SPEED_MIN = 3;
export const DOCUMENT_SPEED_MAX = 120;
export const DOCUMENT_SPEED_STEP = 3;

export function clampDocumentSpeed(value: number): number {
  if (!Number.isFinite(value)) return DOCUMENT_SPEED_MIN;
  return Math.min(DOCUMENT_SPEED_MAX, Math.max(DOCUMENT_SPEED_MIN, Math.round(value)));
}

/**
 * Average the gaps between successive tap timestamps and convert to BPM.
 * Returns null when there aren't at least two taps (no interval to measure).
 */
export function deriveBpmFromTaps(taps: number[]): number | null {
  if (taps.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < taps.length; i++) {
    intervals.push(taps[i] - taps[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avgInterval <= 0) return null;
  return Math.round(60000 / avgInterval);
}

export type SpeedFromBpmInput = {
  detectedBpm: number;
  /** Screens the score advances per song. */
  screensPerSong: number;
  /** Beats per song (preset: 128/256/384). */
  beatsPerSong: number;
  /** Scrollable viewport heights in the loaded document. */
  scrollableScreens: number;
};

function clampSpeed(value: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

export function screensPerMinuteToSpeed(
  screensPerMinute: number,
  scrollableScreens: number
): number {
  if (screensPerMinute <= 0 || scrollableScreens <= 0) return 0;
  return clampSpeed((screensPerMinute / 60) / scrollableScreens);
}

export function speedToScreensPerMinute(speed: number, scrollableScreens: number): number {
  if (speed <= 0 || scrollableScreens <= 0) return 0;
  return speed * scrollableScreens * 60;
}

export function speedToSecondsPerScreen(speed: number, scrollableScreens: number): number | null {
  const screensPerMinute = speedToScreensPerMinute(speed, scrollableScreens);
  if (screensPerMinute <= 0) return null;
  return 60 / screensPerMinute;
}

/**
 * Convert a detected tempo into a normalized scroll speed (progress/second),
 * clamped to [SPEED_MIN, SPEED_MAX]. Returns 0 when inputs are incomplete or
 * invalid (the caller treats 0 as "don't apply").
 *
 *   songSeconds      = beatsPerSong / (bpm / 60)
 *   screensPerSecond = screensPerSong / songSeconds
 *   speed            = screensPerSecond / scrollableScreens
 */
export function calculateSpeedFromBpm({
  detectedBpm,
  screensPerSong,
  beatsPerSong,
  scrollableScreens,
}: SpeedFromBpmInput): number {
  if (!screensPerSong || !beatsPerSong || !scrollableScreens || detectedBpm <= 0) return 0;
  const songDurationSeconds = beatsPerSong / (detectedBpm / 60);
  const screensPerSecond = screensPerSong / songDurationSeconds;
  return screensPerMinuteToSpeed(screensPerSecond * 60, scrollableScreens);
}

/**
 * Convert a tapped musical tempo to the canonical PDF distance travelled per
 * second. The supplied song distance is an intrinsic PDF-point measurement,
 * so the result is identical on every viewport.
 */
export function calculateDocumentSpeedFromBpm({
  detectedBpm,
  documentPointsPerSong,
  beatsPerSong,
}: {
  detectedBpm: number;
  documentPointsPerSong: number;
  beatsPerSong: number;
}): number {
  if (detectedBpm <= 0 || documentPointsPerSong <= 0 || beatsPerSong <= 0) return 0;
  const songDurationSeconds = beatsPerSong / (detectedBpm / 60);
  return clampDocumentSpeed(documentPointsPerSong / songDurationSeconds);
}
