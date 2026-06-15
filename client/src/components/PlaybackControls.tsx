import { useState } from "react";
import {
  Crosshair,
  Gauge,
  Pause,
  Play,
  SkipBack,
  Square,
  Timer,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { SessionState } from "@/types/session";

const SPEED_PRESETS = [
  { label: "Langsam", value: 0.0005 },
  { label: "Mittel", value: 0.001 },
  { label: "Schnell", value: 0.002 },
];

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
  const [duration, setDuration] = useState("");

  function applyDuration() {
    const seconds = Number(duration);
    if (seconds > 0) onSetSpeed(1 / seconds);
  }

  const activePreset = SPEED_PRESETS.find(
    (p) => Math.abs(p.value - session.speed) < 1e-6
  )?.value;

  return (
    <div className="flex flex-col gap-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat icon={<Timer className="size-4" />} label="Fortschritt">
          {(liveProgress * 100).toFixed(1)}%
        </Stat>
        <Stat icon={<Gauge className="size-4" />} label="Tempo">
          {session.speed.toFixed(4)}
        </Stat>
        <Stat
          icon={
            session.playing ? <Play className="size-4" /> : <Pause className="size-4" />
          }
          label="Status"
          tone={session.playing ? "success" : "warning"}
        >
          {session.playing ? "Läuft" : "Pause"}
        </Stat>
        <Stat icon={<Users className="size-4" />} label="Zuschauer">
          {connectedClients}
        </Stat>
      </div>

      {/* Seek */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>Position</span>
          <span className="tabular-nums">{(liveProgress * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[Math.round(liveProgress * 1000)]}
          min={0}
          max={1000}
          step={1}
          onValueChange={([v]) => onSeek(v / 1000)}
          aria-label="Position der Session"
        />
      </div>

      {/* Transport */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {session.playing ? (
          <Button variant="warning" size="lg" onClick={onPause}>
            <Pause />
            Pause
          </Button>
        ) : (
          <Button variant="success" size="lg" onClick={onPlay}>
            <Play />
            Play
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={onStop}>
          <Square />
          Stop
        </Button>
        <Button variant="outline" size="lg" onClick={onRestart}>
          <SkipBack />
          Anfang
        </Button>
        <Button variant="secondary" size="lg" onClick={onSeekToCurrent}>
          <Crosshair />
          Hierher
        </Button>
      </div>

      {/* Speed */}
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Geschwindigkeit
          </span>
          <div className="inline-flex rounded-lg bg-muted p-1">
            {SPEED_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => onSetSpeed(p.value)}
                className={cn(
                  "rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
                  activePreset === p.value
                    ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="dur"
              className="text-xs font-medium text-muted-foreground"
            >
              Songdauer (Sek.)
            </label>
            <Input
              id="dur"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="z. B. 180"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-32"
            />
          </div>
          <Button variant="outline" onClick={applyDuration}>
            Übernehmen
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
