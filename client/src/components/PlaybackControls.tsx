import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Gauge,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  Square,
  Timer,
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
const SPEED_STEP = 0.00002;
const SPEED_MIN = 0.00001;
const SPEED_MAX = 0.002;

type Props = {
  session: SessionState;
  connectedClients: number;
  liveProgress: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSetSpeed: (speed: number) => void;
  onSeek: (progress: number) => void;
  onSeekToCurrent: () => void;
};

export function PlaybackControls({
  session,
  connectedClients,
  liveProgress,
  onPlay,
  onPause,
  onStop,
  onRestart,
  onSetSpeed,
  onSeek,
  onSeekToCurrent,
}: Props) {
  const { t } = useI18n();
  const [duration, setDuration] = useState("");

  // Track the latest intended speed so rapid +/- clicks accumulate even before
  // the server broadcast updates session.speed.
  const speedRef = useRef(session.speed);
  useEffect(() => {
    speedRef.current = session.speed;
  }, [session.speed]);

  function applySpeed(value: number) {
    speedRef.current = value;
    onSetSpeed(value);
  }

  function applyDuration() {
    const seconds = Number(duration);
    if (seconds > 0) applySpeed(1 / seconds);
  }

  function nudge(delta: number) {
    const next = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speedRef.current + delta));
    applySpeed(Number(next.toFixed(5)));
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
          {session.speed.toFixed(5)}
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

      {/* Speed */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-xs font-medium text-muted-foreground">
          {t("controls.speed")}
        </span>

        {/* Presets (slow → fast) + manual steppers */}
        <div className="flex flex-wrap items-center gap-2">
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
              {session.speed.toFixed(5)}
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
        </div>

        {/* Set by song length (1 / seconds) */}
        <div className="flex items-end gap-2 pt-1">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="dur"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("controls.duration")}
            </label>
            <Input
              id="dur"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder={t("controls.durationPlaceholder")}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-32"
            />
          </div>
          <Button variant="outline" onClick={applyDuration}>
            {t("controls.apply")}
          </Button>
        </div>
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
