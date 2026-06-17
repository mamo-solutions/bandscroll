import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Gauge,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  SkipBack,
  Square,
  Timer,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { SessionState } from "@/types/session";

// progress/second across the whole document. Slowest → fastest; the fastest
// here is the old "slow" preset (a full PDF can hold 40+ songs, so even this is
// gentle). Fine-tune beyond these with the Manual +/- steppers.
const SPEED_PRESETS = [0.00005, 0.0001, 0.0002, 0.0003, 0.0005];
const SPEED_STEP = 0.000005;
const SPEED_MIN = 0.00001;
const SPEED_MAX = 0.002;

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
  connectedClients: number;
  liveProgress: number;
  numPages: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSetSpeed: (speed: number) => void;
  onSeek: (progress: number) => void;
  onSeekToCurrent: () => void;
  onAddMarker: (title: string, page: number) => void;
  onDeleteMarker: (id: string) => void;
  onSeekToMarker: (page: number) => void;
};

export function PlaybackControls({
  session,
  connectedClients,
  liveProgress,
  numPages,
  onPlay,
  onPause,
  onStop,
  onRestart,
  onSetSpeed,
  onSeek,
  onSeekToCurrent,
  onAddMarker,
  onDeleteMarker,
  onSeekToMarker,
}: Props) {
  const { t } = useI18n();
  const [pagesPerSong, setPagesPerSong] = useState<string>("2");
  const [markerTitle, setMarkerTitle] = useState("");
  const [markerPage, setMarkerPage] = useState("");
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

  function calculateSpeedFromBpm(detectedBpm: number): number {
    const pages = Number(pagesPerSong);
    if (!pages || !beatsPerSong || !numPages || detectedBpm <= 0) return 0;
    const songProgress = Math.min(1, pages / numPages);
    const songDurationSeconds = beatsPerSong / (detectedBpm / 60);
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, songProgress / songDurationSeconds));
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

    if (taps.length < 2) return;

    const intervals: number[] = [];
    for (let i = 1; i < taps.length; i++) {
      intervals.push(taps[i] - taps[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const detectedBpm = Math.round(60000 / avgInterval);
    setBpm(detectedBpm);

    // Auto-apply once we have at least 4 taps and are outside the cooldown.
    if (
      taps.length >= TAP_MIN_TAPS &&
      now - lastAppliedRef.current >= TAP_COOLDOWN_MS
    ) {
      const speed = calculateSpeedFromBpm(detectedBpm);
      if (speed > 0) {
        applySpeed(speed, true);
        setAcceptedBpm(detectedBpm);
        lastAppliedRef.current = now;
      }
    }
  }

  const activePreset = SPEED_PRESETS.find(
    (v) => Math.abs(v - session.speed) < 1e-7
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat icon={<Timer className="size-4" />} label={t("controls.progress")}>
          {(liveProgress * 100).toFixed(1)}%
        </Stat>
        <Stat icon={<Gauge className="size-4" />} label={t("controls.tempo")}>
          {session.speed.toFixed(6)}
        </Stat>
        <Stat
          icon={
            session.playing ? <Play className="size-4" /> : <Pause className="size-4" />
          }
          label={t("controls.status")}
          tone={session.playing ? "success" : "warning"}
        >
          {session.playing ? t("conn.playing") : t("controls.pause")}
        </Stat>
        <Stat icon={<Users className="size-4" />} label={t("controls.viewers")}>
          {connectedClients}
        </Stat>
      </div>

      {/* Seek */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{t("controls.position")}</span>
          <span className="tabular-nums">{(liveProgress * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[Math.round(liveProgress * 1000)]}
          min={0}
          max={1000}
          step={1}
          onValueChange={([v]) => onSeek(v / 1000)}
          aria-label={t("controls.positionAria")}
        />
      </div>

      {/* Transport */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {session.playing ? (
          <Button variant="warning" size="lg" onClick={onPause}>
            <Pause />
            {t("controls.pause")}
          </Button>
        ) : (
          <Button variant="success" size="lg" onClick={onPlay}>
            <Play />
            {t("controls.play")}
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={onStop}>
          <Square />
          {t("controls.stop")}
        </Button>
        <Button variant="outline" size="lg" onClick={onRestart}>
          <SkipBack />
          {t("controls.startOver")}
        </Button>
        <Button variant="secondary" size="lg" onClick={onSeekToCurrent}>
          <Crosshair />
          {t("controls.here")}
        </Button>
      </div>

      {/* Speed + tap tempo */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {t("controls.speed")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("controls.shortcutsHint")}
          </span>
        </div>

        {/* Presets, manual steppers and tap tempo in one row. */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {SPEED_PRESETS.map((value, i) => (
              <button
                key={value}
                onClick={() => applySpeed(value)}
                aria-label={`${t("controls.speed")} ${i + 1}`}
                className={cn(
                  "w-9 rounded-md py-2 text-sm font-semibold tabular-nums transition-colors",
                  activePreset === value
                    ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => nudge(-SPEED_STEP)}
              disabled={session.speed <= SPEED_MIN}
              aria-label={t("controls.slower")}
            >
              <Minus className="size-4" />
            </Button>
            <span className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums">
              {session.speed.toFixed(6)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => nudge(SPEED_STEP)}
              disabled={session.speed >= SPEED_MAX}
              aria-label={t("controls.faster")}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="mx-1 h-8 w-px bg-border" />

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("controls.tap")}
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTap}
              disabled={numPages === 0}
              className={cn(
                "h-9 min-w-[4.5rem] transition-transform",
                pulse && "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
              aria-label={t("controls.tapTempo")}
            >
              {bpm ?? "—"} <span className="ml-1 text-xs">{t("controls.bpm")}</span>
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="pagesPerSong"
              className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("controls.pagesPerSong")}
            </label>
            <Input
              id="pagesPerSong"
              type="number"
              min={0.1}
              step={0.1}
              inputMode="decimal"
              value={pagesPerSong}
              onChange={(e) => setPagesPerSong(e.target.value)}
              disabled={numPages === 0}
              className="h-9 w-20 px-2"
            />
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            {BEATS_PRESETS.map(({ labelKey, value }) => (
              <button
                key={value}
                onClick={() => setBeatsPerSong(value)}
                disabled={numPages === 0}
                title={t(labelKey)}
                className={cn(
                  "rounded-md px-2.5 py-2 text-xs font-semibold transition-colors",
                  beatsPerSong === value
                    ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {value}
              </button>
            ))}
          </div>

          {numPages === 0 && (
            <span className="self-center text-xs text-muted-foreground">
              {t("controls.tapTempoHint")}
            </span>
          )}
        </div>
      </div>

      {/* Setlist markers */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-xs font-medium text-muted-foreground">
          {t("controls.setlist")}
        </span>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="markerTitle"
              className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("controls.markerTitle")}
            </label>
            <Input
              id="markerTitle"
              type="text"
              value={markerTitle}
              onChange={(e) => setMarkerTitle(e.target.value)}
              placeholder={t("controls.markerTitlePlaceholder")}
              disabled={numPages === 0}
              className="h-9 w-40 px-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="markerPage"
              className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("controls.markerPage")}
            </label>
            <Input
              id="markerPage"
              type="number"
              min={1}
              max={numPages || 1}
              inputMode="numeric"
              value={markerPage}
              onChange={(e) => setMarkerPage(e.target.value)}
              placeholder={numPages > 0 ? `1-${numPages}` : "—"}
              disabled={numPages === 0}
              className="h-9 w-20 px-2"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={numPages === 0 || !markerTitle.trim() || !markerPage}
            onClick={() => {
              onAddMarker(markerTitle, Number(markerPage));
              setMarkerTitle("");
              setMarkerPage("");
            }}
            className="h-9"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("controls.addMarker")}</span>
          </Button>
        </div>

        {(session.markers ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(session.markers ?? []).map((marker) => (
              <div
                key={marker.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-sm"
              >
                <button
                  onClick={() => onSeekToMarker(marker.page)}
                  className="flex items-center gap-1.5 font-medium hover:text-primary"
                  title={t("controls.seekToMarker")}
                >
                  <Music className="size-3.5 text-muted-foreground" />
                  <span className="max-w-[8rem] truncate">{marker.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t("controls.markerPageShort", { page: marker.page })}
                  </span>
                </button>
                <button
                  onClick={() => onDeleteMarker(marker.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t("controls.deleteMarker")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  children,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  tone?: "success" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-heading text-lg font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning"
        )}
      >
        {children}
      </div>
    </div>
  );
}
