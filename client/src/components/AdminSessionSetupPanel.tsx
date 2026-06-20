import { useState } from "react";
import {
  FileEdit,
  FileUp,
  FileWarning,
  Music,
  RefreshCw,
  Square,
  SunMedium,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import {
  type AdminShortcutBindings,
  type AdminShortcutPresetId,
  type AdminShortcutSlot,
  SHORTCUT_OPTIONS,
} from "@/lib/adminShortcuts";
import { cn } from "@/lib/utils";
import type {
  PlaybackMode,
  SessionBackgroundMode,
  SessionState,
} from "@/types/session";

type Props = {
  numPages: number;
  session: SessionState;
  uploading: boolean;
  onAddMarker: (title: string, page: number) => void;
  onDeleteMarker: (id: string) => void;
  onOpenFilePicker: () => void;
  onSeekToMarker: (page: number) => void;
  onSetPlaybackMode: (playbackMode: PlaybackMode) => void;
  onSetBackgroundMode: (backgroundMode: SessionBackgroundMode) => void;
  onShortcutBindingChange: (slot: AdminShortcutSlot, code: string) => void;
  onShortcutPresetChange: (
    presetId: Exclude<AdminShortcutPresetId, "custom">,
  ) => void;
  shortcutBindings: AdminShortcutBindings;
  shortcutPreset: AdminShortcutPresetId;
};

export function AdminSessionSetupPanel({
  numPages,
  session,
  uploading,
  onAddMarker,
  onDeleteMarker,
  onOpenFilePicker,
  onSeekToMarker,
  onSetPlaybackMode,
  onSetBackgroundMode,
  onShortcutBindingChange,
  onShortcutPresetChange,
  shortcutBindings,
  shortcutPreset,
}: Props) {
  const { t } = useI18n();
  const [markerTitle, setMarkerTitle] = useState("");
  const [markerPage, setMarkerPage] = useState("");
  const shortcutFields: ReadonlyArray<{
    slot: AdminShortcutSlot;
    label: string;
  }> = [
    { slot: "playPausePrimary", label: t("control.shortcutPlayPausePrimary") },
    {
      slot: "playPauseSecondary",
      label: t("control.shortcutPlayPauseSecondary"),
    },
    { slot: "tapTempo", label: t("control.shortcutTapTempo") },
    { slot: "speedUp", label: t("control.shortcutSpeedUp") },
    { slot: "speedDown", label: t("control.shortcutSpeedDown") },
    { slot: "restart", label: t("control.shortcutRestart") },
    { slot: "nextMarker", label: t("control.shortcutNextMarker") },
    { slot: "stop", label: t("control.shortcutStop") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden border-border/80 bg-card/95">
        <CardHeader className="gap-3 border-b border-border/70 bg-linear-to-r from-secondary/75 via-card to-accent/45">
          <div>
            <div>
              <CardTitle>{t("control.setupTitle")}</CardTitle>
              <CardDescription>{t("control.setupDesc")}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 pt-4">
          <section className="rounded-xl border border-border/70 bg-muted/35 px-4 pb-4 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-base font-semibold">
                  {t("control.document")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    session.pdfUrl
                      ? "control.documentReady"
                      : "control.documentMissing",
                  )}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border",
                  session.pdfUrl
                    ? "border-success/20 bg-success/10 text-success"
                    : "border-warning/30 bg-warning/10 text-warning",
                )}
              >
                {session.pdfUrl ? (
                  <FileEdit className="size-4" />
                ) : (
                  <FileWarning className="size-4" />
                )}
              </span>
            </div>

            <Button
              variant="outline"
              className="mt-4 w-full justify-center"
              disabled={uploading}
              onClick={onOpenFilePicker}
            >
              {uploading ? (
                <RefreshCw className="animate-spin" />
              ) : session.pdfUrl ? (
                <RefreshCw />
              ) : (
                <FileUp />
              )}
              {uploading
                ? t("control.uploading")
                : session.pdfUrl
                  ? t("control.changePdf")
                  : t("control.addPdf")}
            </Button>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-base font-semibold">
                  {t("controls.playbackMode")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("control.switchModeHint")}
                </p>
              </div>
            </div>

            <div className="mt-4 inline-flex w-full rounded-xl bg-background p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              {(["scroll", "page"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onSetPlaybackMode(mode)}
                  className={cn(
                    "flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
                    session.playbackMode === mode
                      ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === "scroll"
                    ? t("controls.scrollMode")
                    : t("controls.pageMode")}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-base font-semibold">
                  {t("controls.sessionBackground")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("control.backgroundHint")}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    mode: "light",
                    icon: SunMedium,
                    label: t("controls.backgroundLight"),
                    swatchClassName:
                      "border-border/70 bg-linear-to-br from-secondary via-card to-accent/65",
                  },
                  {
                    mode: "black",
                    icon: Square,
                    label: t("controls.backgroundBlack"),
                    swatchClassName: "border-white/15 bg-black",
                  },
                ] as const
              ).map(({ mode, icon: Icon, label, swatchClassName }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onSetBackgroundMode(mode)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    session.backgroundMode === mode
                      ? "border-primary bg-card shadow-[var(--shadow-soft)]"
                      : "border-border/70 bg-background/80 hover:border-primary/40 hover:bg-card/80",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <span
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-lg border",
                        session.backgroundMode === mode
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : "border-border/70 bg-muted/70 text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mt-3 h-16 rounded-lg border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
                      swatchClassName
                    )}
                  >
                    <div className="mx-auto h-full max-w-[4.5rem] rounded-sm bg-white/95 shadow-sm" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-base font-semibold">
                  {t("controls.setlist")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("control.markerHint")}
                </p>
              </div>
              <Badge variant="outline">{session.markers?.length ?? 0}</Badge>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] xl:grid-cols-1">
              <Input
                id="markerTitle"
                type="text"
                value={markerTitle}
                onChange={(e) => setMarkerTitle(e.target.value)}
                placeholder={t("controls.markerTitlePlaceholder")}
                disabled={numPages === 0}
              />
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
              />
              <Button
                variant="outline"
                disabled={numPages === 0 || !markerTitle.trim() || !markerPage}
                onClick={() => {
                  onAddMarker(markerTitle, Number(markerPage));
                  setMarkerTitle("");
                  setMarkerPage("");
                }}
              >
                <Music />
                {t("controls.addMarker")}
              </Button>
            </div>

            {(session.markers ?? []).length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-background/70 px-3 py-4 text-sm text-muted-foreground">
                {t("control.noMarkers")}
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {(session.markers ?? []).map((marker) => (
                  <div
                    key={marker.id}
                    className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/85 px-3 py-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => onSeekToMarker(marker.page)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-primary"
                      title={t("controls.seekToMarker")}
                    >
                      <Music className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate font-medium">
                        {marker.title}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {t("controls.markerPageShort", { page: marker.page })}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteMarker(marker.id)}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("controls.deleteMarker")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <details
            className="group rounded-xl border border-border/70 bg-muted/35"
            open={false}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4">
              <div>
                <h3 className="font-heading text-base font-semibold">
                  {t("control.shortcutsTitle")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("control.shortcutsDesc")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {shortcutPreset === "custom"
                    ? t("control.shortcutsPresetCustom")
                    : shortcutPreset === "footswitch"
                      ? t("control.shortcutsPresetFootswitch")
                      : shortcutPreset === "media"
                        ? t("control.shortcutsPresetMedia")
                        : t("control.shortcutsPresetNumpad")}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground transition-transform group-open:rotate-180">
                  ▾
                </span>
              </div>
            </summary>

            <div className="border-t border-border/70 px-4 py-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t("control.shortcutsPreset")}
                  </label>
                  <Select
                    value={shortcutPreset}
                    onChange={(e) => {
                      const value = e.target.value as AdminShortcutPresetId;
                      if (value === "custom") return;
                      onShortcutPresetChange(value);
                    }}
                  >
                    <option value="footswitch">
                      {t("control.shortcutsPresetFootswitch")}
                    </option>
                    <option value="media">
                      {t("control.shortcutsPresetMedia")}
                    </option>
                    <option value="numpad">
                      {t("control.shortcutsPresetNumpad")}
                    </option>
                    <option value="custom">
                      {t("control.shortcutsPresetCustom")}
                    </option>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("control.shortcutsPresetHint")}
                  </p>
                </div>

                <div className="grid gap-3">
                  {shortcutFields.map(({ slot, label }) => (
                    <div
                      key={slot}
                      className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center sm:gap-3"
                    >
                      <label className="text-sm font-medium text-foreground">
                        {label}
                      </label>
                      <Select
                        value={shortcutBindings[slot]}
                        onChange={(e) =>
                          onShortcutBindingChange(slot, e.target.value)
                        }
                      >
                        {SHORTCUT_OPTIONS.map((option) => (
                          <option
                            key={option.code || "none"}
                            value={option.code}
                          >
                            {option.code === ""
                              ? t("control.shortcutsNone")
                              : option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
