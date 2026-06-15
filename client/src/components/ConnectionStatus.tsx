import { Pause, Play, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  connected: boolean;
  playing?: boolean;
};

/** Compact, self-explaining connection + playback indicator (icon + text). */
export function ConnectionStatus({ connected, playing }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium sm:text-sm">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
          connected
            ? "bg-success/15 text-success"
            : "bg-destructive/12 text-destructive"
        )}
      >
        {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {connected ? "Verbunden" : "Getrennt"}
      </span>

      {connected && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
            playing ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
          )}
        >
          {playing ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {playing ? "Läuft" : "Pausiert"}
        </span>
      )}
    </div>
  );
}
