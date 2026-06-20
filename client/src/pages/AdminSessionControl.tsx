import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FileWarning,
  LayoutDashboard,
  Loader2,
  LogOut,
  Maximize,
  Minimize,
  Music,
  RefreshCw,
} from "lucide-react";
import { api } from "@/api/client";
import { auth } from "@/api/auth";
import { AdminSessionSetupPanel } from "@/components/AdminSessionSetupPanel";
import { PdfViewer, type PdfViewerHandle } from "@/components/PdfViewer";
import { PlaybackControls, type PlaybackControlsHandle } from "@/components/PlaybackControls";
import { useHeaderSlot } from "@/components/HeaderSlot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  assignShortcutBinding,
  deriveShortcutPreset,
  getShortcutAction,
  getShortcutPresetBindings,
  loadShortcutBindings,
  saveShortcutBindings,
  type AdminShortcutBindings,
  type AdminShortcutPresetId,
  type AdminShortcutSlot,
} from "@/lib/adminShortcuts";
import { reportError } from "@/lib/errorLog";
import {
  clampPage,
  getPlaybackDisplayProgress,
  progressToNearestPage,
} from "@/lib/playback";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useWakeLock } from "@/lib/useWakeLock";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { getSocket, useSocketStatus } from "@/sockets/socket";
import { clamp01, type PlaybackMode, type SessionState, type SongMarker } from "@/types/session";

export function AdminSessionControl() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [uiProgress, setUiProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [distractionFree, setDistractionFree] = useState(false);
  const [shortcutBindings, setShortcutBindings] = useState<AdminShortcutBindings>(() =>
    loadShortcutBindings()
  );

  const viewerRef = useRef<PdfViewerHandle>(null);
  const playbackRef = useRef<PlaybackControlsHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const liveProgressRef = useRef(0);
  const numPagesRef = useRef(0);
  const reportedNumPagesRef = useRef<number | null>(null);
  const lastWallRef = useRef<number>(Date.now());
  const pdfInput = useRef<HTMLInputElement>(null);

  const KB_SPEED_STEP = 0.000005;
  const KB_SPEED_MIN = 0.00001;
  const KB_SPEED_MAX = 0.002;
  const socket = getSocket();
  const socketStatus = useSocketStatus();

  useDocumentTitle(session ? session.title : t("control.loading"));
  useWakeLock(true);

  const patchSession = useCallback((patch: Partial<SessionState>) => {
    setSession((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      stateRef.current = next;
      return next;
    });
  }, []);

  const syncUiProgress = useCallback(
    (nextSession: SessionState, nextProgress = liveProgressRef.current) => {
      setUiProgress(
        getPlaybackDisplayProgress(
          nextSession.playbackMode,
          nextProgress,
          nextSession.currentPage,
          numPagesRef.current
        )
      );
    },
    []
  );

  useEffect(() => {
    stateRef.current = session;
  }, [session]);

  useEffect(() => {
    numPagesRef.current = numPages;
  }, [numPages]);

  useEffect(() => {
    saveShortcutBindings(shortcutBindings);
  }, [shortcutBindings]);

  const advance = useCallback(() => {
    const now = Date.now();
    const currentSession = stateRef.current;
    if (currentSession?.playing && currentSession.playbackMode === "scroll") {
      const dt = Math.max(0, (now - lastWallRef.current) / 1000);
      liveProgressRef.current = clamp01(liveProgressRef.current + currentSession.speed * dt);
    }
    lastWallRef.current = now;
  }, []);

  useEffect(() => {
    const handler = () => {
      setDistractionFree(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    api.adminSession(id).then((loaded) => {
      lastWallRef.current = Date.now();
      stateRef.current = loaded;
      setSession(loaded);
      liveProgressRef.current = loaded.progress;
      setUiProgress(
        getPlaybackDisplayProgress(
          loaded.playbackMode,
          loaded.progress,
          loaded.currentPage,
          numPagesRef.current
        )
      );
    });

    const onState = (nextSession: SessionState) => {
      if (nextSession.id !== id) return;
      stateRef.current = nextSession;
      setSession(nextSession);
      if (nextSession.playbackMode === "scroll") {
        liveProgressRef.current = nextSession.progress;
        syncUiProgress(nextSession);
      } else {
        setUiProgress(
          getPlaybackDisplayProgress(
            nextSession.playbackMode,
            nextSession.progress,
            nextSession.currentPage,
            numPagesRef.current
          )
        );
      }
      if (!nextSession.playing) {
        lastWallRef.current = Date.now();
      }
    };
    const onError = (e: { error: string }) => reportError("admin.socket", e?.error);

    socket.on("session-state", onState);
    socket.on("admin-error", onError);

    return () => {
      socket.off("session-state", onState);
      socket.off("admin-error", onError);
    };
  }, [id, socket, syncUiProgress]);

  useEffect(() => {
    if (socketStatus.state === "connected") {
      socket.emit("admin-join-session", id);
    }
  }, [id, socket, socketStatus.state]);

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
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 max-w-[12rem] truncate font-heading text-sm font-semibold sm:max-w-[16rem] md:max-w-[20rem] lg:max-w-[26rem]">
            {session.title}
          </h1>
          <Badge variant="outline" className="font-mono">
            {session.code}
          </Badge>
          <Badge variant="outline">{t("controls.viewers")}: {session.connectedClients}</Badge>
          <Badge variant={session.playing ? "live" : "outline"}>
            {session.playing ? t("conn.playing") : t("conn.paused")}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
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
  }, [session, distractionFree, setNode, navigate, t]);

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const currentSession = stateRef.current;
      const viewer = viewerRef.current;
      if (currentSession && viewer && currentSession.playbackMode === "scroll") {
        if (currentSession.playing) {
          advance();
          viewer.scrollToProgress(liveProgressRef.current);
        } else {
          liveProgressRef.current = viewer.getCurrentProgress();
          lastWallRef.current = Date.now();
        }
        if (frame++ % 10 === 0) syncUiProgress(currentSession);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance, syncUiProgress]);

  useEffect(() => {
    if (session?.playbackMode !== "page") return;
    setUiProgress(getPlaybackDisplayProgress("page", session.progress, session.currentPage, numPages));
  }, [numPages, session?.currentPage, session?.playbackMode, session?.progress]);

  useEffect(() => {
    if (!session?.pdfUrl || numPages <= 0) return;
    if (reportedNumPagesRef.current === numPages && session.numPages === numPages) return;
    reportedNumPagesRef.current = numPages;
    patchSession({ numPages });
    socket.emit("admin-set-num-pages", { sessionId: id, numPages });
  }, [id, numPages, patchSession, session?.numPages, session?.pdfUrl, socket]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!session) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const action = getShortcutAction(e.code, shortcutBindings);
      if (action === null) return;

      switch (action) {
        case "playPause":
          e.preventDefault();
          session.playing ? pause() : play();
          break;
        case "tapTempo":
          e.preventDefault();
          playbackRef.current?.tap();
          break;
        case "speedUp":
          e.preventDefault();
          setSpeed(Math.min(KB_SPEED_MAX, Math.max(KB_SPEED_MIN, session.speed + KB_SPEED_STEP)));
          break;
        case "speedDown":
          e.preventDefault();
          setSpeed(Math.min(KB_SPEED_MAX, Math.max(KB_SPEED_MIN, session.speed - KB_SPEED_STEP)));
          break;
        case "restart":
          e.preventDefault();
          restart();
          break;
        case "nextMarker":
          e.preventDefault();
          jumpToNextMarker();
          break;
        case "stop":
          e.preventDefault();
          stop();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session, shortcutBindings]);

  function play() {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    if (currentSession.playbackMode === "scroll") {
      socket.emit("admin-seek", { sessionId: id, progress: liveProgressRef.current });
    } else {
      socket.emit("admin-set-page", { sessionId: id, page: currentSession.currentPage });
    }

    patchSession({ playing: true, status: "live" });
    socket.emit("admin-play", id);
  }

  function pause() {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    if (currentSession.playbackMode === "scroll") {
      socket.emit("admin-seek", { sessionId: id, progress: liveProgressRef.current });
    } else {
      socket.emit("admin-set-page", { sessionId: id, page: currentSession.currentPage });
    }

    patchSession({ playing: false });
    socket.emit("admin-pause", id);
  }

  function stop() {
    socket.emit("admin-stop", id);
    liveProgressRef.current = 0;
    lastWallRef.current = Date.now();
    patchSession({ playing: false, progress: 0, currentPage: 1 });
    viewerRef.current?.scrollToPage(1);
    setUiProgress(
      getPlaybackDisplayProgress(stateRef.current?.playbackMode ?? "scroll", 0, 1, numPagesRef.current)
    );
  }

  function restart() {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    if (currentSession.playbackMode === "scroll") {
      seek(0);
      return;
    }

    goToPage(1);
  }

  function seekToCurrent() {
    const currentSession = stateRef.current;
    const viewer = viewerRef.current;
    if (!currentSession || !viewer) return;

    if (currentSession.playbackMode === "page") {
      goToPage(viewer.getCurrentPage());
      return;
    }

    seek(viewer.getCurrentProgress());
  }

  function seek(progress: number) {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    const clampedProgress = clamp01(progress);
    liveProgressRef.current = clampedProgress;
    lastWallRef.current = Date.now();
    viewerRef.current?.scrollToProgress(clampedProgress);
    patchSession({ progress: clampedProgress });
    setUiProgress(
      getPlaybackDisplayProgress(
        currentSession.playbackMode,
        clampedProgress,
        currentSession.currentPage,
        numPages
      )
    );
    socket.emit("admin-seek", { sessionId: id, progress: clampedProgress });
  }

  function goToPage(page: number) {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    const nextPage = clampPage(page, Math.max(numPages, 1));
    viewerRef.current?.scrollToPage(nextPage);
    patchSession({ currentPage: nextPage });
    setUiProgress(
      getPlaybackDisplayProgress(currentSession.playbackMode, currentSession.progress, nextPage, numPages)
    );
    socket.emit("admin-set-page", { sessionId: id, page: nextPage });
  }

  function setSpeed(speed: number) {
    socket.emit("admin-set-speed", { sessionId: id, speed });
    patchSession({ speed });
  }

  function setPlaybackMode(playbackMode: PlaybackMode) {
    const currentSession = stateRef.current;
    const viewer = viewerRef.current;
    if (!currentSession || !viewer || currentSession.playbackMode === playbackMode) return;

    if (playbackMode === "page") {
      const currentPage =
        viewer.getCurrentPage() ||
        progressToNearestPage(liveProgressRef.current, Math.max(numPages, 1));
      patchSession({ playbackMode, currentPage });
      setUiProgress(getPlaybackDisplayProgress("page", liveProgressRef.current, currentPage, numPages));
      socket.emit("admin-set-playback-mode", {
        sessionId: id,
        playbackMode,
        currentPage,
        progress: liveProgressRef.current,
      });
      viewer.scrollToPage(currentPage);
      return;
    }

    const progress = viewer.getProgressForPage(currentSession.currentPage);
    liveProgressRef.current = progress;
    lastWallRef.current = Date.now();
    patchSession({ playbackMode, progress });
    setUiProgress(getPlaybackDisplayProgress("scroll", progress, currentSession.currentPage, numPages));
    socket.emit("admin-set-playback-mode", {
      sessionId: id,
      playbackMode,
      progress,
      currentPage: currentSession.currentPage,
    });
    viewer.scrollToProgress(progress);
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
    const next = (session.markers ?? []).filter((marker) => marker.id !== markerId);
    setMarkers(next);
  }

  function seekToMarker(page: number) {
    if (!numPages || page < 1 || page > numPages) return;
    if (stateRef.current?.playbackMode === "page") {
      goToPage(page);
      return;
    }
    const progress =
      viewerRef.current?.getProgressForPage(page) ?? clamp01((page - 1) / Math.max(numPages, 1));
    seek(progress);
  }

  function jumpToNextMarker() {
    const markers = (stateRef.current?.markers ?? []).slice().sort((a, b) => a.page - b.page);
    if (markers.length === 0) return;

    const currentPage =
      stateRef.current?.playbackMode === "page"
        ? stateRef.current.currentPage
        : viewerRef.current?.getCurrentPage() ??
          progressToNearestPage(liveProgressRef.current, Math.max(numPages, 1));

    const nextMarker = markers.find((marker) => marker.page > currentPage) ?? markers[0];
    seekToMarker(nextMarker.page);
  }

  async function handleLogout() {
    await auth.logout();
    navigate("/admin/login", { replace: true });
  }

  async function changePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const updated = await api.uploadPdf(id, file);
      liveProgressRef.current = 0;
      lastWallRef.current = Date.now();
      stateRef.current = updated;
      setSession(updated);
      setUiProgress(
        getPlaybackDisplayProgress(
          updated.playbackMode,
          updated.progress,
          updated.currentPage,
          numPagesRef.current
        )
      );
    } finally {
      setUploading(false);
    }
  }

  function handleShortcutBindingChange(slot: AdminShortcutSlot, code: string) {
    setShortcutBindings((current) => assignShortcutBinding(current, slot, code));
  }

  function handleShortcutPresetChange(presetId: Exclude<AdminShortcutPresetId, "custom">) {
    setShortcutBindings(getShortcutPresetBindings(presetId));
  }

  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">{t("control.loading")}</p>
      </main>
    );
  }

  const shortcutPreset = deriveShortcutPreset(shortcutBindings);

  return (
    <main
      className={cn(
        "mx-auto w-full flex-1 px-4 pt-4 sm:px-6",
        distractionFree ? "max-w-none pb-0" : "max-w-7xl pb-8"
      )}
    >
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={changePdf}
      />

      {!distractionFree &&
        socketStatus.state !== "connected" &&
        socketStatus.hasEverConnected && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-medium text-warning"
        >
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
          distractionFree
            ? "h-dvh"
            : "grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(22rem,1fr)] xl:items-start"
        )}
      >
        <Card
          className={cn(
            "relative overflow-hidden p-0",
            distractionFree && "h-dvh",
            !distractionFree && "border-border/80 bg-card/95"
          )}
        >
          {!distractionFree && (
            <div className="border-b border-border/70 bg-muted/35 px-4 py-3 sm:px-5">
              <div className="h-2" aria-hidden="true" />
            </div>
          )}

          <div className="relative">
            <div
              className={cn(
                distractionFree ? "h-dvh" : "h-[52vh] min-h-[24rem] sm:h-[60vh] xl:h-[62vh]"
              )}
            >
              {session.pdfUrl ? (
                <PdfViewer
                  key={session.pdfUrl}
                  ref={viewerRef}
                  fileUrl={session.pdfUrl}
                  visiblePage={session.playbackMode === "page" ? session.currentPage : undefined}
                  onUserScroll={(progress) => {
                    if (stateRef.current?.playing) return;
                    if (stateRef.current?.playbackMode === "page") {
                      const page = viewerRef.current?.getCurrentPage() ?? 1;
                      setUiProgress(getPlaybackDisplayProgress("page", progress, page, numPages));
                      return;
                    }
                    liveProgressRef.current = progress;
                    setUiProgress(progress);
                  }}
                  onDocumentLoad={setNumPages}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                  <FileWarning className="size-7" />
                  <p className="font-medium">{t("control.noPdfTitle")}</p>
                  <p className="max-w-md text-sm">{t("control.noPdfDesc")}</p>
                </div>
              )}
            </div>

            {distractionFree && (session.markers ?? []).length > 0 && (
              <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-6rem)] w-52 overflow-y-auto rounded-xl border border-border/60 bg-background/88 p-2 shadow-[var(--shadow-lift)] backdrop-blur-md">
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
                      <span className="font-mono text-xs text-muted-foreground">{marker.page}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!distractionFree && (
            <div className="border-t border-border/70 bg-background/70 p-4 sm:p-5">
              <PlaybackControls
                ref={playbackRef}
                session={session}
                liveProgress={uiProgress}
                numPages={numPages}
                onPlay={play}
                onPause={pause}
                onStop={stop}
                onRestart={restart}
                onSetSpeed={setSpeed}
                onSeekToCurrent={seekToCurrent}
                onPreviousPage={() => goToPage(session.currentPage - 1)}
                onNextPage={() => goToPage(session.currentPage + 1)}
              />
            </div>
          )}
        </Card>

        {!distractionFree && (
          <div className="xl:sticky xl:top-20">
            <AdminSessionSetupPanel
              numPages={numPages}
              session={session}
              uploading={uploading}
              onAddMarker={addMarker}
              onDeleteMarker={deleteMarker}
              onOpenFilePicker={() => pdfInput.current?.click()}
              onSeekToMarker={seekToMarker}
              onSetPlaybackMode={setPlaybackMode}
              onShortcutBindingChange={handleShortcutBindingChange}
              onShortcutPresetChange={handleShortcutPresetChange}
              shortcutBindings={shortcutBindings}
              shortcutPreset={shortcutPreset}
            />
          </div>
        )}
      </div>

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
