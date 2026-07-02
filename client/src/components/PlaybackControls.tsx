import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
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
import { useI18n } from "@/i18n/I18nProvider";
import { getPageDwellMs } from "@/lib/playback";
import {
  SPEED_MAX,
  SPEED_MIN,
  calculateSpeedFromBpm,
  deriveBpmFromTaps,
  screensPerMinuteToSpeed,
  speedToScreensPerMinute,
  speedToSecondsPerScreen,
} from "@/lib/tempo";
import { cn } from "@/lib/utils";
import type { SessionState } from "@/types/session";

const SCREEN_SPEED_PRESETS = [1, 3, 5, 7];
const SCREEN_SPEED_STEP = 0.25;
const PAGE_SECONDS_STEP = 1;

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
  scrollableScreens: number | null;
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
    scrollableScreens,
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
  const [screensPerSong, setScreensPerSong] = useState<string>("3.0");
  const [beatsPerSong, setBeatsPerSong] = useState<number>(BEATS_PRESETS[1].value);
  const [bpm, setBpm] = useState<number | null>(null);
  const [pulse, setPulse] = useState(false);
  const [acceptedBpm, setAcceptedBpm] = useState<number | null>(null);

  const speedRef = useRef(session.speed);
  useEffect(() => {
    speedRef.current = session.speed;
  }, [session.speed]);

  const tapsRef = useRef<number[]>([]);
  const lastAppliedRef = useRef<number>(0);

  const canControlScrollTempo =
    session.playbackMode === "scroll" &&
    scrollableScreens !== null &&
    Number.isFinite(scrollableScreens) &&
    scrollableScreens > 0;
  const currentScreensPerMinute = canControlScrollTempo
    ? speedToScreensPerMinute(session.speed, scrollableScreens)
    : null;
  const currentSecondsPerScreen = canControlScrollTempo
    ? speedToSecondsPerScreen(session.speed, scrollableScreens)
    : null;
  const pageDwellMs =
    session.playbackMode === "page" && numPages > 0 ? getPageDwellMs(session.speed, numPages) : null;
  const currentSecondsPerPage =
    pageDwellMs === null ? null : pageDwellMs / 1000;

  const minScreensPerMinute =
    scrollableScreens !== null && scrollableScreens > 0
      ? speedToScreensPerMinute(SPEED_MIN, scrollableScreens)
      : null;
  const maxScreensPerMinute =
    scrollableScreens !== null && scrollableScreens > 0
      ? speedToScreensPerMinute(SPEED_MAX, scrollableScreens)
      : null;
  const minSecondsPerPage =
    session.playbackMode === "page" && numPages > 0
      ? (getPageDwellMs(SPEED_MAX, numPages) ?? 0) / 1000
      : null;
  const maxSecondsPerPage =
    session.playbackMode === "page" && numPages > 0
      ? (getPageDwellMs(SPEED_MIN, numPages) ?? 0) / 1000
      : null;

  const speedDisplay =
    session.playbackMode === "scroll"
      ? currentScreensPerMinute !== null
        ? `${currentScreensPerMinute.toFixed(1)} ${t("controls.screensPerMinuteUnit")}`
        : t("controls.scrollTempoUnavailable")
      : currentSecondsPerPage !== null
        ? `${currentSecondsPerPage.toFixed(1)} ${t("controls.secondsPerPageUnit")}`
        : t("controls.scrollTempoUnavailable");
  const speedHelper =
    session.playbackMode === "scroll"
      ? currentSecondsPerScreen !== null
        ? `${t("controls.approxPrefix")} ${currentSecondsPerScreen.toFixed(1)} ${t("controls.secondsPerScreenUnit")}`
        : t("controls.loadDocumentFirst")
      : currentSecondsPerPage !== null
        ? `${t("controls.approxPrefix")} ${currentSecondsPerPage.toFixed(1)} ${t("controls.secondsPerPageUnit")}`
        : t("controls.scrollTempoUnavailable");

  function applyRawSpeed(value: number, fromTap = false) {
    speedRef.current = value;
    onSetSpeed(value);
    if (!fromTap) setAcceptedBpm(null);
  }

  function applyScreensPerMinute(value: number, fromTap = false) {
    if (!canControlScrollTempo || scrollableScreens === null) return;
    const rawSpeed = screensPerMinuteToSpeed(value, scrollableScreens);
    if (rawSpeed <= 0) return;
    applyRawSpeed(rawSpeed, fromTap);
  }

  function applySecondsPerPage(value: number) {
    if (session.playbackMode !== "page" || numPages <= 0 || value <= 0) return;
    const rawSpeed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, 1 / (value * numPages)));
    applyRawSpeed(rawSpeed);
  }

  function nudgeScrollTempo(delta: number) {
    if (currentScreensPerMinute === null || minScreensPerMinute === null || maxScreensPerMinute === null) {
      return;
    }
    const next = Math.min(
      maxScreensPerMinute,
      Math.max(minScreensPerMinute, currentScreensPerMinute + delta)
    );
    applyScreensPerMinute(next);
  }

  function nudgePageTempo(deltaSeconds: number) {
    if (currentSecondsPerPage === null || minSecondsPerPage === null || maxSecondsPerPage === null) return;
    const next = Math.min(
      maxSecondsPerPage,
      Math.max(minSecondsPerPage, currentSecondsPerPage + deltaSeconds)
    );
    applySecondsPerPage(Number(next.toFixed(1)));
  }

  function handleTap() {
    if (!canControlScrollTempo || scrollableScreens === null) return;

    const now = Date.now();
    const taps = tapsRef.current;

    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_COOLDOWN_MS) {
      taps.length = 0;
      setAcceptedBpm(null);
    }

    taps.push(now);
    if (taps.length > TAP_MAX_HISTORY) taps.shift();

    setPulse(true);
    setTimeout(() => setPulse(false), 120);

    const detectedBpm = deriveBpmFromTaps(taps);
    if (detectedBpm === null) return;
    setBpm(detectedBpm);

    if (taps.length >= TAP_MIN_TAPS && now - lastAppliedRef.current >= TAP_COOLDOWN_MS) {
      const speed = calculateSpeedFromBpm({
        detectedBpm,
        screensPerSong: Number(screensPerSong),
        beatsPerSong,
        scrollableScreens,
      });
      if (speed > 0) {
        applyRawSpeed(speed, true);
        setAcceptedBpm(detectedBpm);
        lastAppliedRef.current = now;
      }
    }
  }

  useImperativeHandle(ref, () => ({ tap: handleTap }), [handleTap]);

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

  const activePreset = SCREEN_SPEED_PRESETS.find(
    (value) => currentScreensPerMinute !== null && Math.abs(value - currentScreensPerMinute) < 0.25
  );
  const currentPresetIndex =
    currentScreensPerMinute === null
      ? null
      : SCREEN_SPEED_PRESETS.reduce((bestIndex, value, index) => {
          const bestDistance = Math.abs(SCREEN_SPEED_PRESETS[bestIndex] - currentScreensPerMinute);
          const distance = Math.abs(value - currentScreensPerMinute);
          return distance < bestDistance ? index : bestIndex;
        }, 0);
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
                {t("controls.tempo")}: {speedDisplay}
              </InlineBadge>
              <InlineBadge>
                {t("controls.position")}: {progressLabel}
              </InlineBadge>
            </div>
          </div>

          <Badge variant="outline">
            {session.playbackMode === "scroll" && currentPresetIndex !== null
              ? `${SCREEN_SPEED_PRESETS[currentPresetIndex].toFixed(0)} ${t("controls.screensPerMinuteShort")}`
              : speedDisplay}
          </Badge>
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

          {session.playbackMode === "scroll" ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label={t("controls.quickTempo")}
                  className="inline-flex rounded-xl bg-muted p-1"
                >
                  {SCREEN_SPEED_PRESETS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => applyScreensPerMinute(value)}
                      disabled={!canControlScrollTempo}
                      aria-label={`${t("controls.speed")} ${value}`}
                      aria-pressed={activePreset === value}
                      className={cn(
                        "min-w-11 rounded-lg px-2 py-2 text-sm font-semibold tabular-nums transition-colors",
                        activePreset === value
                          ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                          : "text-muted-foreground hover:text-foreground",
                        !canControlScrollTempo && "cursor-not-allowed opacity-50"
                      )}
                    >
                      {value}
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
                    onClick={() => nudgeScrollTempo(-SCREEN_SPEED_STEP)}
                    disabled={!canControlScrollTempo}
                    aria-label={t("controls.slower")}
                  >
                    <Minus className="size-4" />
                  </Button>
                  <span className="min-w-[7rem] text-center text-sm font-semibold tabular-nums">
                    {currentScreensPerMinute !== null ? currentScreensPerMinute.toFixed(1) : "—"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    onClick={() => nudgeScrollTempo(SCREEN_SPEED_STEP)}
                    disabled={!canControlScrollTempo}
                    aria-label={t("controls.faster")}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>

                <Button
                  variant="secondary"
                  onClick={handleTap}
                  disabled={!canControlScrollTempo}
                  className={cn(
                    "min-w-[7rem] transition-transform",
                    pulse && "scale-105 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                  aria-label={t("controls.tapTempo")}
                >
                  {bpm ?? "—"} <span className="text-xs">{t("controls.bpm")}</span>
                </Button>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">{speedHelper}</p>

              {!canControlScrollTempo && (
                <p className="mt-2 text-sm text-muted-foreground">{t("controls.loadDocumentFirst")}</p>
              )}
            </>
          ) : (
            <>
              <div
                role="group"
                aria-label={t("controls.manualTempoHint")}
                className="mt-4 inline-flex items-center gap-1 rounded-xl bg-muted p-1"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() => nudgePageTempo(PAGE_SECONDS_STEP)}
                  disabled={currentSecondsPerPage === null}
                  aria-label={t("controls.slower")}
                >
                  <Minus className="size-4" />
                </Button>
                <span className="min-w-[7rem] text-center text-sm font-semibold tabular-nums">
                  {currentSecondsPerPage !== null ? currentSecondsPerPage.toFixed(1) : "—"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() => nudgePageTempo(-PAGE_SECONDS_STEP)}
                  disabled={currentSecondsPerPage === null}
                  aria-label={t("controls.faster")}
                >
                  <Plus className="size-4" />
                </Button>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">{speedHelper}</p>
            </>
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
                  htmlFor="screensPerSong"
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                >
                  {t("controls.screensPerSong")}
                </label>
                <Input
                  id="screensPerSong"
                  type="number"
                  min={0.1}
                  step={0.1}
                  inputMode="decimal"
                  value={screensPerSong}
                  onChange={(e) => setScreensPerSong(e.target.value)}
                  disabled={!canControlScrollTempo}
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
                      disabled={!canControlScrollTempo}
                      title={t(labelKey)}
                      aria-pressed={beatsPerSong === value}
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                        beatsPerSong === value
                          ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                          : "text-muted-foreground hover:text-foreground",
                        !canControlScrollTempo && "cursor-not-allowed opacity-50"
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

function InlineBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1 text-sm font-medium text-foreground">
      {children}
    </span>
  );
}
