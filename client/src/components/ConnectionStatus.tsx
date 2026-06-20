import { Pause, Play, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { ViewerConnectionPhase } from "@/lib/sessionSync";

type Props = {
  playing?: boolean;
  phase?: ViewerConnectionPhase;
};

/** Compact, self-explaining connection + playback indicator (icon + text). */
export function ConnectionStatus({ playing, phase = "syncing" }: Props) {
  const { t } = useI18n();
  const connectionLabel =
    phase === "disconnected"
      ? t("conn.disconnected")
      : phase === "connected"
        ? t("conn.connected")
        : t("conn.syncing");

  const playbackLabel = playing ? t("conn.playing") : t("conn.paused");

  return (
    <div className="flex items-center gap-2 text-xs font-medium sm:text-sm">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
          phase === "disconnected"
            ? "bg-destructive/12 text-destructive"
            : phase === "connected"
              ? "bg-success/15 text-success"
              : "bg-warning/15 text-warning"
        )}
      >
        {phase === "disconnected" ? (
          <WifiOff className="size-3.5" />
        ) : (
          <Wifi className="size-3.5" />
        )}
        {connectionLabel}
      </span>

      {phase !== "disconnected" && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
            playing ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
          )}
        >
          {playing ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {playbackLabel}
        </span>
      )}
    </div>
  );
}
