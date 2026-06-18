// Pure tap-tempo math, extracted from PlaybackControls so it can be unit-tested
// without rendering React. The component owns the tap timing/state; these
// functions are the deterministic core that turns taps into a scroll speed.

/** Scroll speed bounds (progress/second across the whole document). */
export const SPEED_MIN = 0.00001;
export const SPEED_MAX = 0.002;

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
  /** Pages the band advances per song. */
  pagesPerSong: number;
  /** Beats per song (preset: 128/256/384). */
  beatsPerSong: number;
  /** Total pages in the loaded document. */
  numPages: number;
};

/**
 * Convert a detected tempo into a normalized scroll speed (progress/second),
 * clamped to [SPEED_MIN, SPEED_MAX]. Returns 0 when inputs are incomplete or
 * invalid (the caller treats 0 as "don't apply").
 *
 *   songProgress  = pagesPerSong / numPages          (fraction of doc per song)
 *   songSeconds   = beatsPerSong / (bpm / 60)        (seconds the song lasts)
 *   speed         = songProgress / songSeconds
 */
export function calculateSpeedFromBpm({
  detectedBpm,
  pagesPerSong,
  beatsPerSong,
  numPages,
}: SpeedFromBpmInput): number {
  if (!pagesPerSong || !beatsPerSong || !numPages || detectedBpm <= 0) return 0;
  const songProgress = Math.min(1, pagesPerSong / numPages);
  const songDurationSeconds = beatsPerSong / (detectedBpm / 60);
  return Math.min(
    SPEED_MAX,
    Math.max(SPEED_MIN, songProgress / songDurationSeconds)
  );
}
