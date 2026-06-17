import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CircleDot,
  FileEdit,
  FileUp,
  FileWarning,
  LayoutDashboard,
  Loader2,
  LogOut,
  Maximize,
  Minimize,
  Music,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "@/api/client";
import { getSocket } from "@/sockets/socket";
import { auth } from "@/api/auth";
import { PdfViewer, type PdfViewerHandle } from "@/components/PdfViewer";
import { PlaybackControls, type PlaybackControlsHandle } from "@/components/PlaybackControls";
import { useHeaderSlot } from "@/components/HeaderSlot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useWakeLock } from "@/lib/useWakeLock";
import { clamp01, type SessionState, type SongMarker } from "@/types/session";

export function AdminSessionControl() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [distractionFree, setDistractionFree] = useState(false);
  const [isLandscapeMobile, setIsLandscapeMobile] = useState(false);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const playbackRef = useRef<PlaybackControlsHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const liveProgressRef = useRef(0);
  // Wall-clock timestamp of the last integration step. The conductor's scroll
  // position is integrated locally from this (monotonic, never reset by the
  // server echo), which avoids the sawtooth from re-deriving position from our
  // own round-tripped admin-sync. Wall-clock (not rAF frames) keeps playback
  // advancing while the tab is backgrounded.
  const lastWallRef = useRef<number>(Date.now());

  // Advance the local playback position by the real elapsed time. Idempotent
  // w.r.t. call frequency, so the rAF loop (smooth scroll) and the 250 ms sync
  // emitter can both call it.
  const advance = useCallback(() => {
    const now = Date.now();
    const s = stateRef.current;
    if (s?.playing) {
      const dt = Math.max(0, (now - lastWallRef.current) / 1000);
      liveProgressRef.current = clamp01(liveProgressRef.current + s.speed * dt);
    }
    lastWallRef.current = now;
  }, []);
  const pdfInput = useRef<HTMLInputElement>(null);

  const KB_SPEED_STEP = 0.000005;
  const KB_SPEED_MIN = 0.00001;
  const KB_SPEED_MAX = 0.002;

  useDocumentTitle(session ? session.title : t("control.loading"));
  useWakeLock(true);

  useEffect(() => {
    stateRef.current = session;
  }, [session]);

  // ---- Detect phone/tablet landscape mode for the marker sidebar ----
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-width: 1024px)");
    const update = () => setIsLandscapeMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ---- Sync distraction-free state with browser fullscreen ----
  useEffect(() => {
    const handler = () => {
      setDistractionFree(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ---- Load + socket wiring ----
  useEffect(() => {
    api.adminSession(id).then((s) => {
      lastWallRef.current = Date.now();
      setSession(s);
      liveProgressRef.current = s.progress;
    });

    const socket = getSocket();
    const onConnect = () => {
      setConnected(true);
      socket.emit("admin-join-session", id);
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: SessionState) => {
      // Refresh UI state (speed, playing, markers, …) only. The scroll position
      // is integrated locally and must NOT be reset from the echo of our own
      // admin-sync, or it sawtooths back ~RTT*speed every cycle.
      if (s.id === id) setSession(s);
    };
    const onError = (e: { error: string }) =>
      console.warn("admin socket error:", e?.error);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("session-state", onState);
    socket.on("admin-error", onError);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("session-state", onState);
      socket.off("admin-error", onError);
    };
  }, [id]);

  // ---- Project session header into the shared layout header bar ----
  const { setNode, setHidden } = useHeaderSlot();
  useEffect(() => {
    setHidden(distractionFree);
  }, [distractionFree, setHidden]);

  useEffect(() => {
    if (!session || distractionFree) {
      setNode(null);
      return;
    }
    setNode(
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
        <h1 className="hidden truncate font-heading text-base font-semibold sm:block sm:max-w-[12rem] md:max-w-[18rem] lg:max-w-[24rem]">
          {session.title}
        </h1>

        <span className="rounded-lg bg-secondary px-2 py-0.5 font-mono text-xs font-semibold text-secondary-foreground">
          {session.code}
        </span>

        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full",
            session.status === "live" && "bg-success/15 text-success",
            session.status === "draft" && "bg-warning/15 text-warning",
            session.status === "ended" && "bg-muted text-muted-foreground"
          )}
          title={t(`status.${session.status}` as const)}
        >
          {session.status === "live" && <Radio className="size-3.5" />}
          {session.status === "draft" && <FileEdit className="size-3.5" />}
          {session.status === "ended" && <CircleDot className="size-3.5" />}
        </span>

        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full",
            connected ? "bg-success/15 text-success" : "bg-destructive/12 text-destructive"
          )}
          title={connected ? t("conn.connected") : t("conn.disconnected")}
        >
          {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        </span>
        {connected && (
          <span
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full",
              session.playing ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
            )}
            title={session.playing ? t("conn.playing") : t("conn.paused")}
          >
            {session.playing ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={changePdf}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => pdfInput.current?.click()}
          >
            {uploading ? (
              <Loader2 className="animate-spin" />
            ) : session.pdfUrl ? (
              <RefreshCw />
            ) : (
              <FileUp />
            )}
            <span className="hidden sm:inline">
              {uploading
                ? t("control.uploading")
                : session.pdfUrl
                  ? t("control.changePdf")
                  : t("control.addPdf")}
            </span>
          </Button>

          <Button variant="outline" size="sm" onClick={() => navigate("/admin")}>
            <LayoutDashboard />
            <span className="hidden sm:inline">{t("nav.dashboard")}</span>
          </Button>

          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut />
            <span className="hidden sm:inline">{t("nav.logout")}</span>
          </Button>
        </div>
      </div>
    );
    return () => setNode(null);
  }, [session, connected, uploading, distractionFree, setNode, t, navigate, pdfInput]);

  // ---- Auto-scroll loop: when playing, follow the computed progress ----
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const s = stateRef.current;
      const viewer = viewerRef.current;
      if (s && viewer) {
        if (s.playing) {
          advance();
          viewer.scrollToProgress(liveProgressRef.current);
        } else {
          // Paused: track manual scrolling and keep the clock fresh so the next
          // play() doesn't integrate a huge gap.
          liveProgressRef.current = viewer.getCurrentProgress();
          lastWallRef.current = Date.now();
        }
      }
      if (frame++ % 10 === 0) setUiProgress(liveProgressRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance]);

  // ---- While playing, emit a slim sync ~every 250ms ----
  // Emits the locally-integrated position (advance() uses wall-clock elapsed),
  // so it stays correct even when rAF is throttled in a backgrounded tab.
  useEffect(() => {
    if (!session?.playing) return;
    const socket = getSocket();
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      // Wall-clock advance keeps the emitted position correct even when rAF is
      // throttled (tab backgrounded).
      advance();
      socket.emit("admin-sync", {
        sessionId: id,
        progress: liveProgressRef.current,
        playing: true,
      });
    }, 250);
    return () => clearInterval(interval);
  }, [session?.playing, id, advance]);

  // ---- Keyboard shortcuts for live conducting ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!session) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      switch (e.key) {
        case " ":
        case "ArrowRight":
          e.preventDefault();
          session.playing ? pause() : play();
          break;
        case "ArrowLeft":
          e.preventDefault();
          playbackRef.current?.tap();
          break;
        case "ArrowUp":
          e.preventDefault();
          setSpeed(
            Math.min(KB_SPEED_MAX, Math.max(KB_SPEED_MIN, session.speed + KB_SPEED_STEP))
          );
          break;
        case "ArrowDown":
          e.preventDefault();
          setSpeed(
            Math.min(KB_SPEED_MAX, Math.max(KB_SPEED_MIN, session.speed - KB_SPEED_STEP))
          );
          break;
        case "r":
        case "R":
          e.preventDefault();
          restart();
          break;
        case "s":
        case "S":
          e.preventDefault();
          stop();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session, id]);

  const socket = getSocket();

  function play() {
    socket.emit("admin-seek", { sessionId: id, progress: liveProgressRef.current });
    socket.emit("admin-play", id);
  }
  function pause() {
    socket.emit("admin-seek", { sessionId: id, progress: liveProgressRef.current });
    socket.emit("admin-pause", id);
  }
  function stop() {
    socket.emit("admin-stop", id);
    liveProgressRef.current = 0;
    viewerRef.current?.scrollToProgress(0);
  }
  function restart() {
    socket.emit("admin-seek", { sessionId: id, progress: 0 });
    liveProgressRef.current = 0;
    viewerRef.current?.scrollToProgress(0);
  }
  function seekToCurrent() {
    const p = viewerRef.current?.getCurrentProgress() ?? 0;
    seek(p);
  }
  function seek(progress: number) {
    liveProgressRef.current = progress;
    viewerRef.current?.scrollToProgress(progress);
    setUiProgress(progress);
    socket.emit("admin-seek", { sessionId: id, progress });
  }
  function setSpeed(speed: number) {
    socket.emit("admin-set-speed", { sessionId: id, speed });
  }

  function setMarkers(markers: SongMarker[]) {
    socket.emit("admin-set-markers", { sessionId: id, markers });
  }

  function addMarker(title: string, page: number) {
    if (!session || !title.trim() || page < 1 || page > numPages) return;
    const marker: SongMarker = {
      id: crypto.randomUUID(),
      title: title.trim(),
      page,
    };
    const next = [...(session.markers ?? []), marker].sort((a, b) => a.page - b.page);
    setMarkers(next);
  }

  function deleteMarker(markerId: string) {
    if (!session) return;
    const next = (session.markers ?? []).filter((m) => m.id !== markerId);
    setMarkers(next);
  }

  function seekToMarker(page: number) {
    if (!numPages || page < 1 || page > numPages) return;
    const progress = viewerRef.current?.getProgressForPage(page) ?? clamp01((page - 1) / numPages);
    seek(progress);
  }

  async function handleLogout() {
    await auth.logout();
    navigate("/admin/login", { replace: true });
  }

  // Swap the PDF mid-session (e.g. choose another song). The server resets
  // progress + pauses and broadcasts, so all viewers reload the new document.
  async function changePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    try {
      const updated = await api.uploadPdf(id, file);
      liveProgressRef.current = 0;
      setUiProgress(0);
      setSession(updated);
    } finally {
      setUploading(false);
    }
  }

  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">{t("control.loading")}</p>
      </main>
    );
  }

  return (
    <main
      className={cn(
        "mx-auto w-full flex-1 px-4 pt-0 sm:px-6",
        distractionFree ? "max-w-none pb-0" : "max-w-5xl pb-8"
      )}
    >
      {!distractionFree && !connected && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t("control.disconnected")}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-md bg-warning px-3 py-1.5 text-xs font-semibold text-warning-foreground transition-colors hover:bg-warning/90"
          >
            <RefreshCw className="size-3.5" />
            {t("control.reload")}
          </button>
        </div>
      )}

      <div
        className={cn(
          "flex gap-4",
          isLandscapeMobile && !distractionFree ? "flex-row" : "flex-col"
        )}
      >
        {/* PDF preview -- starts right below the sticky header */}
        <Card
          className={cn(
            "relative overflow-hidden p-0",
            distractionFree ? "mb-0 h-dvh" : "mb-5",
            isLandscapeMobile && !distractionFree ? "flex-1" : "w-full"
          )}
        >
          <div className={cn(!distractionFree && "h-[48vh] sm:h-[58vh]", distractionFree && "h-full")}>
            {session.pdfUrl ? (
              <PdfViewer
                key={session.pdfUrl}
                ref={viewerRef}
                fileUrl={session.pdfUrl}
                onUserScroll={(p) => {
                  if (!stateRef.current?.playing) liveProgressRef.current = p;
                }}
                onDocumentLoad={setNumPages}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <FileWarning className="size-7" />
                <p className="font-medium">{t("control.noPdfTitle")}</p>
                <p className="text-sm">{t("control.noPdfDesc")}</p>
              </div>
            )}
          </div>

          {/* Floating setlist overlay in distraction-free mode */}
          {distractionFree && (session.markers ?? []).length > 0 && (
            <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-6rem)] w-44 overflow-y-auto rounded-xl border border-border/60 bg-background/85 p-2 shadow-[var(--shadow-lift)] backdrop-blur-md">
              <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("controls.setlist")}
              </div>
              <div className="flex flex-col gap-0.5">
                {(session.markers ?? []).map((marker) => (
                  <button
                    key={marker.id}
                    type="button"
                    onClick={() => seekToMarker(marker.page)}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <Music className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{marker.title}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {marker.page}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Marker sidebar for phone/tablet landscape */}
        {isLandscapeMobile && !distractionFree && (
          <Card className="w-44 shrink-0 overflow-hidden p-0">
            <div className="flex h-[48vh] flex-col sm:h-[58vh]">
              <div className="border-b border-border bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("controls.setlist")}
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {(session.markers ?? []).length === 0 ? (
                  <p className="p-2 text-xs text-muted-foreground">
                    {t("control.noMarkers")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {(session.markers ?? []).map((marker) => (
                      <button
                        key={marker.id}
                        type="button"
                        onClick={() => seekToMarker(marker.page)}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <Music className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{marker.title}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {marker.page}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Controls */}
      {!distractionFree && (
        <Card className="p-5 sm:p-6">
          <PlaybackControls
            ref={playbackRef}
            session={session}
            connectedClients={session.connectedClients}
            liveProgress={uiProgress}
            numPages={numPages}
            onPlay={play}
            onPause={pause}
            onStop={stop}
            onRestart={restart}
            onSetSpeed={setSpeed}
            onSeek={seek}
            onSeekToCurrent={seekToCurrent}
            onAddMarker={addMarker}
            onDeleteMarker={deleteMarker}
            onSeekToMarker={seekToMarker}
          />
        </Card>
      )}

      {/* Distraction-free toggle (also triggers browser fullscreen) */}
      <button
        type="button"
        onClick={async () => {
          const next = !distractionFree;
          setDistractionFree(next);
          if (!document.fullscreenEnabled) return;
          try {
            if (next && !document.fullscreenElement) {
              await document.documentElement.requestFullscreen();
            } else if (!next && document.fullscreenElement) {
              await document.exitFullscreen();
            }
          } catch {
            // Fullscreen request may be denied; keep the UI state change.
          }
        }}
        className="fixed bottom-4 right-4 z-50 inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[var(--shadow-lift)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={distractionFree ? t("control.showUi") : t("control.hideUi")}
        aria-label={distractionFree ? t("control.showUi") : t("control.hideUi")}
      >
        {distractionFree ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
      </button>
    </main>
  );
}
