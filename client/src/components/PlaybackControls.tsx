import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SPEED_MAX,
  SPEED_MIN,
  calculateSpeedFromBpm,
  deriveBpmFromTaps,
} from "@/lib/tempo";
import { useI18n } from "@/i18n/I18nProvider";
import type { SessionState } from "@/types/session";

// progress/second across the whole document. Slowest → fastest; the fastest
// here is the old "slow" preset (a full PDF can hold 40+ songs, so even this is
// gentle). Fine-tune beyond these with the Manual +/- steppers.
const SPEED_PRESETS = [0.00005, 0.0001, 0.0002, 0.0003, 0.0005];
const SPEED_STEP = 0.000005;

const BEATS_PRESETS = [
  { labelKey: "controls.beatsShort", value: 128 },
  { labelKey: "controls.beatsMedium", value: 256 },
  { labelKey: "controls.beatsLong", value: 384 },
] as const;

const TAP_MIN_TAPS = 4;
const TAP_COOLDOWN_MS = 2000;
const TAP_MAX_HISTORY = 8;

type Props = {
  session: SessionState;
  liveProgress: number;
  numPages: number;
  hidePrimaryControlsOnDesktop?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSetSpeed: (speed: number) => void;
  onSeekToCurrent: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

export type PlaybackControlsHandle = {
  /** Trigger the tap-tempo button (visual pulse + auto-apply on enough taps). */
  tap: () => void;
};

export const PlaybackControls = forwardRef<PlaybackControlsHandle, Props>(function PlaybackControls(
  {
    session,
    liveProgress,
    numPages,
    hidePrimaryControlsOnDesktop = false,
    onPlay,
    onPause,
    onStop,
    onRestart,
    onSetSpeed,
    onSeekToCurrent,
    onPreviousPage,
    onNextPage,
  }: Props,
  ref
) {
  const { t } = useI18n();
  const [pagesPerSong, setPagesPerSong] = useState<string>("2");
  const [beatsPerSong, setBeatsPerSong] = useState<number>(BEATS_PRESETS[1].value);
  const [bpm, setBpm] = useState<number | null>(null);
  const [pulse, setPulse] = useState(false);
  const [acceptedBpm, setAcceptedBpm] = useState<number | null>(null);

  // Track the latest intended speed so rapid +/- clicks accumulate even before
  // the server broadcast updates session.speed.
  const speedRef = useRef(session.speed);
  useEffect(() => {
    speedRef.current = session.speed;
  }, [session.speed]);

  // Tap tempo state is kept in refs so rapid taps don't thrash React.
  const tapsRef = useRef<number[]>([]);
  const lastAppliedRef = useRef<number>(0);

  useImperativeHandle(ref, () => ({ tap: handleTap }), [handleTap]);

  // Continuous pulse on the tap button at the accepted BPM.
  useEffect(() => {
    if (!acceptedBpm || acceptedBpm <= 0) return;
    const beatMs = 60000 / acceptedBpm;
    let clearFlash: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setPulse(true);
      clearFlash = setTimeout(() => setPulse(false), 120);
    }, beatMs);
    return () => {
      clearInterval(interval);
      if (clearFlash) clearTimeout(clearFlash);
    };
  }, [acceptedBpm]);

  function applySpeed(value: number, fromTap = false) {
    speedRef.current = value;
    onSetSpeed(value);
    if (!fromTap) setAcceptedBpm(null);
  }

  function nudge(delta: number) {
    const next = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speedRef.current + delta));
    applySpeed(Number(next.toFixed(6)));
  }

  function handleTap() {
    const now = Date.now();
    const taps = tapsRef.current;

    // Restart if the user paused tapping for longer than the cooldown.
    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_COOLDOWN_MS) {
      taps.length = 0;
      setAcceptedBpm(null);
    }

    taps.push(now);
    if (taps.length > TAP_MAX_HISTORY) taps.shift();

    // Visual pulse on every tap.
    setPulse(true);
    setTimeout(() => setPulse(false), 120);

    const detectedBpm = deriveBpmFromTaps(taps);
    if (detectedBpm === null) return;
    setBpm(detectedBpm);

    // Auto-apply once we have at least 4 taps and are outside the cooldown.
    if (
      taps.length >= TAP_MIN_TAPS &&
      now - lastAppliedRef.current >= TAP_COOLDOWN_MS
    ) {
      const speed = calculateSpeedFromBpm({
        detectedBpm,
        pagesPerSong: Number(effectivePagesPerSong),
        beatsPerSong,
        numPages,
      });
      if (speed > 0) {
        applySpeed(speed, true);
        setAcceptedBpm(detectedBpm);
        lastAppliedRef.current = now;
      }
    }
  }

  const activePreset = SPEED_PRESETS.find((value) => Math.abs(value - session.speed) < 1e-7);
  const currentPresetIndex = SPEED_PRESETS.reduce((bestIndex, value, index) => {
    const bestDistance = Math.abs(SPEED_PRESETS[bestIndex] - session.speed);
    const distance = Math.abs(value - session.speed);
    return distance < bestDistance ? index : bestIndex;
  }, 0);
  const effectivePagesPerSong = session.playbackMode === "page" ? "1" : pagesPerSong;
  const currentPage = Math.min(Math.max(session.currentPage, 1), Math.max(numPages, 1));
  const progressLabel =
    session.playbackMode === "scroll"
      ? `${Math.round(liveProgress * 100)}%`
      : `${currentPage} / ${Math.max(numPages, 1)}`;
  const desktopDuplicateControlsClass = hidePrimaryControlsOnDesktop ? "lg:hidden" : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[1.4rem] border border-border/80 bg-linear-to-br from-card via-card to-secondary/40 p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("control.liveDockTitle")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <InlineBadge>
                {session.playing ? t("conn.playing") : t("conn.paused")}
              </InlineBadge>
              <InlineBadge>
                {t("controls.playbackMode")}:{" "}
                {session.playbackMode === "scroll"
                  ? t("controls.scrollMode")
                  : t("controls.pageMode")}
              </InlineBadge>
              <InlineBadge>
                {t("controls.tempo")}: {session.speed.toFixed(6)}
              </InlineBadge>
              <InlineBadge>
                {t("controls.position")}: {progressLabel}
              </InlineBadge>
            </div>
          </div>

          <Badge variant="outline">#{currentPresetIndex + 1}</Badge>
        </div>

        <div className={cn("mt-4 flex flex-wrap gap-2.5", desktopDuplicateControlsClass)}>
          {session.playing ? (
            <Button
              variant="warning"
              onClick={onPause}
              className="min-w-[11rem] flex-1 sm:flex-none"
              title={t("controls.pause")}
            >
              <Pause />
              {t("controls.pause")}
            </Button>
          ) : (
            <Button
              variant="success"
              onClick={onPlay}
              className="min-w-[11rem] flex-1 sm:flex-none"
              title={t("controls.play")}
            >
              <Play />
              {t("controls.play")}
            </Button>
          )}
          <Button variant="outline" onClick={onStop} title={t("controls.stop")}>
            <Square />
            {t("controls.stop")}
          </Button>
          <Button variant="outline" onClick={onRestart} title={t("controls.startOver")}>
            <SkipBack />
            {t("controls.startOver")}
          </Button>
          <Button variant="secondary" onClick={onSeekToCurrent} title={t("controls.here")}>
            <Crosshair />
            {t("controls.here")}
          </Button>
        </div>

        <div className="mt-5 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold">{t("controls.quickTempo")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("controls.quickTempoHint")}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t("controls.quickTempo")}
              className="inline-flex rounded-xl bg-muted p-1"
            >
              {SPEED_PRESETS.map((value, index) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applySpeed(value)}
                  aria-label={`${t("controls.speed")} ${index + 1}`}
                  aria-pressed={activePreset === value}
                  className={cn(
                    "w-10 rounded-lg py-2 text-sm font-semibold tabular-nums transition-colors",
                    activePreset === value
                      ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {index + 1}
                </button>
              ))}
            </div>

            <div
              role="group"
              aria-label={t("controls.manualTempoHint")}
              className="inline-flex items-center gap-1 rounded-xl bg-muted p-1"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => nudge(-SPEED_STEP)}
                disabled={session.speed <= SPEED_MIN}
                aria-label={t("controls.slower")}
              >
                <Minus className="size-4" />
              </Button>
              <span className="min-w-[5rem] text-center text-sm font-semibold tabular-nums">
                {session.speed.toFixed(6)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => nudge(SPEED_STEP)}
                disabled={session.speed >= SPEED_MAX}
                aria-label={t("controls.faster")}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <Button
              variant="secondary"
              onClick={handleTap}
              disabled={numPages === 0}
              className={cn(
                "min-w-[7rem] transition-transform",
                pulse && "scale-105 ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
              aria-label={t("controls.tapTempo")}
            >
              {bpm ?? "—"} <span className="text-xs">{t("controls.bpm")}</span>
            </Button>
          </div>

          {numPages === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">{t("controls.tapTempoHint")}</p>
          )}
        </div>
      </div>

      {session.playbackMode === "page" && (
        <section
          className={cn(
            "rounded-2xl border border-border/80 bg-muted/30 p-4",
            desktopDuplicateControlsClass
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="text-muted-foreground">{t("controls.currentPage")}</span>
              <span className="font-heading text-lg tabular-nums">
                {currentPage} / {Math.max(numPages, 1)}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={onPreviousPage}
                disabled={currentPage <= 1}
                className="justify-center"
              >
                <ChevronLeft />
                {t("controls.previousPage")}
              </Button>
              <Button
                variant="outline"
                onClick={onNextPage}
                disabled={numPages > 0 && currentPage >= numPages}
                className="justify-center"
              >
                <ChevronRight />
                {t("controls.nextPage")}
              </Button>
            </div>
          </div>
        </section>
      )}

      <details className="group rounded-2xl border border-border/80 bg-card/80">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <h3 className="font-heading text-base font-semibold">{t("controls.advancedTempo")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("controls.manualTempoHint")}</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>

        <div className="border-t border-border/70 px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)]">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-[9rem] flex-col gap-1">
                <label
                  htmlFor="pagesPerSong"
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                >
                  {t("controls.pagesPerSong")}
                </label>
                <Input
                  id="pagesPerSong"
                  type="number"
                  min={0.1}
                  step={0.1}
                  inputMode="decimal"
                  value={effectivePagesPerSong}
                  onChange={(e) => setPagesPerSong(e.target.value)}
                  disabled={numPages === 0 || session.playbackMode === "page"}
                  className="h-10"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("controls.beatsPerSong")}
                </span>
                <div
                  role="group"
                  aria-label={t("controls.beatsPerSong")}
                  className="inline-flex rounded-xl bg-muted p-1"
                >
                  {BEATS_PRESETS.map(({ labelKey, value }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBeatsPerSong(value)}
                      disabled={numPages === 0}
                      title={t(labelKey)}
                      aria-pressed={beatsPerSong === value}
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                        beatsPerSong === value
                          ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground">
              {t("controls.shortcutsHint")}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
});

function InlineBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1 text-sm font-medium text-foreground">
      {children}
    </span>
  );
}
