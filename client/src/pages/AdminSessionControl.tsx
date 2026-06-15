import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { FileUp, FileWarning, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { getSocket } from "@/sockets/socket";
import { AdminNav } from "@/components/AdminNav";
import { PdfViewer, type PdfViewerHandle } from "@/components/PdfViewer";
import { PlaybackControls } from "@/components/PlaybackControls";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";
import { effectiveProgress, type SessionState } from "@/types/session";

export function AdminSessionControl() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const liveProgressRef = useRef(0);
  const pdfInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    stateRef.current = session;
  }, [session]);

  // ---- Load + socket wiring ----
  useEffect(() => {
    api.adminSession(id).then((s) => {
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

  // ---- Auto-scroll loop: when playing, follow the computed progress ----
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const s = stateRef.current;
      const viewer = viewerRef.current;
      if (s && viewer) {
        if (s.playing) {
          const target = effectiveProgress(s);
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
  useEffect(() => {
    if (!session?.playing) return;
    const socket = getSocket();
    const interval = setInterval(() => {
      socket.emit("admin-sync", {
        sessionId: id,
        progress: liveProgressRef.current,
        playing: true,
      });
    }, 250);
    return () => clearInterval(interval);
  }, [session?.playing, id]);

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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <AdminNav title={session.title} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-secondary px-2.5 py-1 font-mono text-sm font-semibold text-secondary-foreground">
          {session.code}
        </span>
        <SessionStatusBadge status={session.status} />
        <div className="ml-auto flex items-center gap-2">
          <ConnectionStatus connected={connected} playing={session.playing} />
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf"
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
        </div>
      </div>

      {/* PDF preview */}
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
          session={session}
          connectedClients={session.connectedClients}
          liveProgress={uiProgress}
          onPlay={play}
          onPause={pause}
          onStop={stop}
          onRestart={restart}
          onSetSpeed={setSpeed}
          onSeek={seek}
          onSeekToCurrent={seekToCurrent}
        />
      </Card>
    </main>
  );
}
