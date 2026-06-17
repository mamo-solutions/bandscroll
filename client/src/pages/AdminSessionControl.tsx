import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CircleDot,
  FileEdit,
  FileUp,
  FileWarning,
  LayoutDashboard,
  Loader2,
  LogOut,
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
import { clamp01, effectiveProgressFromElapsed, type SessionState, type SongMarker } from "@/types/session";

export function AdminSessionControl() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [numPages, setNumPages] = useState(0);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const playbackRef = useRef<PlaybackControlsHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const liveProgressRef = useRef(0);
  const receivedAtRef = useRef<number>(Date.now());
  const pdfInput = useRef<HTMLInputElement>(null);

  const KB_SPEED_STEP = 0.000005;
  const KB_SPEED_MIN = 0.00001;
  const KB_SPEED_MAX = 0.002;

  useDocumentTitle(session ? session.title : t("control.loading"));
  useWakeLock(true);

  useEffect(() => {
    stateRef.current = session;
  }, [session]);

  // ---- Load + socket wiring ----
  useEffect(() => {
    api.adminSession(id).then((s) => {
      receivedAtRef.current = Date.now();
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
      if (s.id === id) {
        receivedAtRef.current = Date.now();
        setSession(s);
      }
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
  const { setNode } = useHeaderSlot();
  useEffect(() => {
    if (!session) {
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
  }, [session, connected, uploading, setNode, t, navigate, pdfInput]);

  // ---- Auto-scroll loop: when playing, follow the computed progress ----
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const s = stateRef.current;
      const viewer = viewerRef.current;
      if (s && viewer) {
        if (s.playing) {
          const elapsed = Date.now() - receivedAtRef.current;
          const target = effectiveProgressFromElapsed(s, elapsed);
          liveProgressRef.current = target;
          viewer.scrollToProgress(target);
        } else {
          liveProgressRef.current = viewer.getCurrentProgress();
        }
      }
      if (frame++ % 10 === 0) setUiProgress(liveProgressRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- While playing, emit a slim sync ~every 250ms ----
  // Use effectiveProgressFromElapsed() with a locally-recorded receive time so
  // the emitted progress stays correct when the browser throttles
  // requestAnimationFrame while the tab is in the background, and avoids
  // backwards scrolling on devices whose clock is behind the server's clock.
  useEffect(() => {
    if (!session?.playing) return;
    const socket = getSocket();
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      const elapsed = Date.now() - receivedAtRef.current;
      socket.emit("admin-sync", {
        sessionId: id,
        progress: effectiveProgressFromElapsed(s, elapsed),
        playing: true,
      });
    }, 250);
    return () => clearInterval(interval);
  }, [session?.playing, id]);

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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-8 pt-0 sm:px-6">
      {!connected && (
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

      {/* PDF preview -- starts right below the sticky header */}
      <Card className="mb-5 overflow-hidden p-0">
        <div className="h-[48vh] sm:h-[58vh]">
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
      </Card>

      {/* Controls */}
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
    </main>
  );
}
