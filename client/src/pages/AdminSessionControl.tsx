import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileWarning,
  LayoutDashboard,
  Loader2,
  LogOut,
  Maximize,
  Music,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import { api, ApiError } from "@/api/client";
import { auth } from "@/api/auth";
import { AdminSessionSetupPanel } from "@/components/AdminSessionSetupPanel";
import {
  PdfViewer,
  type PdfViewerHandle,
} from "@/components/PdfViewer";
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
import { resolveMarkerPages } from "@/lib/markerPageResolution";
import {
  clampPage,
  getPageDwellMs,
  getPlaybackDisplayProgress,
  progressToNearestPage,
} from "@/lib/playback";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useWakeLock } from "@/lib/useWakeLock";
import { useI18n } from "@/i18n/I18nProvider";
import {
  DOCUMENT_SPEED_DEFAULT,
  DOCUMENT_SPEED_STEP,
  SPEED_MAX,
  SPEED_MIN,
  clampDocumentSpeed,
} from "@/lib/tempo";
import { cn } from "@/lib/utils";
import { getSocket, useSocketStatus } from "@/sockets/socket";
import type {
  AiConfigResponse,
  MarkerGenerationSocketEvent,
  MarkerSuggestion,
  MarkerSuggestionSet,
} from "@/types/ai";
import {
  clamp01,
  effectiveDocumentCursor,
  type PlaybackMode,
  type SessionBackgroundMode,
  type SessionState,
  type SongMarker,
} from "@/types/session";

export function AdminSessionControl() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [uiProgress, setUiProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [distractionFree, setDistractionFree] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingSessionDetails, setSavingSessionDetails] = useState(false);
  const [savingDocumentDescription, setSavingDocumentDescription] = useState(false);
  const [markerGenerationAvailable, setMarkerGenerationAvailable] = useState(false);
  const [markerSuggestionSet, setMarkerSuggestionSet] = useState<MarkerSuggestionSet | null>(null);
  const [generatingMarkers, setGeneratingMarkers] = useState(false);
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
  // Set true when scroll-mode auto-stop has fired; suppresses further advance
  // until the authoritative paused state arrives back via session-state.
  const autoStopEngagedRef = useRef(false);
  const markerRepairSignatureRef = useRef<string | null>(null);
  const markerRepairInFlightRef = useRef(false);
  const cursorCommandInFlightRef = useRef(false);
  const cursorPositionCommandInFlightRef = useRef(false);
  const pdfInput = useRef<HTMLInputElement>(null);

  const KB_DOCUMENT_SPEED_STEP = DOCUMENT_SPEED_STEP;
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
    const currentSession = stateRef.current;
    const viewer = viewerRef.current;
    if (
      !currentSession?.pdfUrl ||
      !viewer ||
      numPages <= 0 ||
      markerRepairInFlightRef.current ||
      (currentSession.markers?.length ?? 0) === 0
    ) {
      return;
    }

    const signature = [
      currentSession.id,
      currentSession.pdfUrl,
      ...currentSession.markers.map((marker) => `${marker.id}:${marker.title}:${marker.page}`),
    ].join("|");
    if (markerRepairSignatureRef.current === signature) return;

    markerRepairInFlightRef.current = true;
    void (async () => {
      try {
        const repairedMarkers = await resolveMarkerPages(
          currentSession.markers,
          Math.max(numPagesRef.current, 1),
          (title, minimumPage, maximumPage) =>
            viewer.findMarkerPage(title, minimumPage, maximumPage)
        );
        const changed = repairedMarkers.some(
          (marker, index) => marker.page !== currentSession.markers[index]?.page
        );

        if (changed) {
          patchSession({ markers: repairedMarkers });
          setMarkers(repairedMarkers);
        }

        markerRepairSignatureRef.current = changed
          ? [
              currentSession.id,
              currentSession.pdfUrl,
              ...repairedMarkers.map((marker) => `${marker.id}:${marker.title}:${marker.page}`),
            ].join("|")
          : signature;
      } finally {
        markerRepairInFlightRef.current = false;
      }
    })();
  }, [numPages, patchSession, session?.id, session?.markers, session?.pdfUrl]);

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
    void loadAiMarkerState();

    const onState = (nextSession: SessionState) => {
      if (nextSession.id !== id) return;
      const shouldApplyCommandCursor = cursorPositionCommandInFlightRef.current;
      cursorCommandInFlightRef.current = false;
      cursorPositionCommandInFlightRef.current = false;
      stateRef.current = nextSession;
      setSession(nextSession);
      if (nextSession.playbackMode === "scroll") {
        if (
          (nextSession.playing || shouldApplyCommandCursor) &&
          nextSession.documentCursor &&
          nextSession.documentGeometry
        ) {
          viewerRef.current?.scrollToDocumentCursor(nextSession.documentCursor, nextSession.documentGeometry);
        }
        // While auto-stop is engaged but the authoritative pause hasn't landed
        // yet, keep progress pinned at the stop point instead of chasing a late
        // still-playing tick past the boundary.
        if (!(autoStopEngagedRef.current && nextSession.playing)) {
          liveProgressRef.current = nextSession.progress;
        }
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
    const onError = (e: { error: string }) => {
      cursorCommandInFlightRef.current = false;
      cursorPositionCommandInFlightRef.current = false;
      if (e?.error === "control-version-stale") {
        setErrorMessage("control-version-stale");
        return;
      }
      setErrorMessage(e?.error ?? "control-failed");
      reportError("admin.socket", e?.error);
    };
    const onMarkerGenerationUpdated = (payload: MarkerGenerationSocketEvent) => {
      if (payload.sessionId !== id) return;
      setGeneratingMarkers(false);
      void loadAiMarkerState();
    };

    socket.on("session-state", onState);
    socket.on("admin-error", onError);
    socket.on("admin-marker-generation-updated", onMarkerGenerationUpdated);

    return () => {
      socket.off("session-state", onState);
      socket.off("admin-error", onError);
      socket.off("admin-marker-generation-updated", onMarkerGenerationUpdated);
    };
  }, [id, socket, syncUiProgress]);

  async function loadAiMarkerState() {
    try {
      const config = await api.aiConfig();
      setMarkerGenerationAvailable(hasMarkerGenerationCapability(config));
    } catch {
      setMarkerGenerationAvailable(false);
    }

    try {
      const suggestions = await api.markerSuggestions(id);
      setMarkerSuggestionSet(suggestions);
      setGeneratingMarkers(suggestions.status === "running");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setMarkerSuggestionSet(null);
        setGeneratingMarkers(false);
        return;
      }
      setMarkerSuggestionSet(null);
      setGeneratingMarkers(false);
    }
  }

  useEffect(() => {
    if (socketStatus.state === "connected") {
      socket.emit("admin-join-session", id);
    }
  }, [id, socket, socketStatus.state]);

  useEffect(() => {
    if (socketStatus.state !== "connected" || !session?.documentGeometry) return;
    const renew = () => socket.emit("admin-control-lease", id);
    renew();
    const interval = window.setInterval(renew, 5_000);
    return () => window.clearInterval(interval);
  }, [id, session?.documentGeometry, socket, socketStatus.state]);

  const { setNode, setHidden, setFooterHidden } = useHeaderSlot();
  useEffect(() => {
    setHidden(distractionFree);
    setFooterHidden(distractionFree);
    return () => setFooterHidden(false);
  }, [distractionFree, setFooterHidden, setHidden]);

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/admin")}
            aria-label={t("nav.dashboard")}
            title={t("nav.dashboard")}
          >
            <LayoutDashboard />
            <span className="hidden sm:inline">{t("nav.dashboard")}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            aria-label={t("nav.logout")}
            title={t("nav.logout")}
          >
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
        const cursor = effectiveDocumentCursor(
          currentSession,
          currentSession.playing ? Date.now() - (currentSession.positionUpdatedAt ?? Date.now()) : 0
        );
        if (currentSession.playing && cursor && currentSession.documentGeometry) {
          viewer.scrollToDocumentCursor(cursor, currentSession.documentGeometry);
          raf = requestAnimationFrame(tick);
          return;
        }
        if (currentSession.playing) {
          if (!autoStopEngagedRef.current) {
            const prevProgress = liveProgressRef.current;
            advance();
            maybeAutoStopAtSongEnd(prevProgress);
          }
          viewer.scrollToProgress(liveProgressRef.current);
        } else {
          autoStopEngagedRef.current = false;
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
          adjustKeyboardSpeed(KB_DOCUMENT_SPEED_STEP);
          break;
        case "speedDown":
          e.preventDefault();
          adjustKeyboardSpeed(-KB_DOCUMENT_SPEED_STEP);
          break;
        case "restart":
          e.preventDefault();
          restart();
          break;
        case "previousPage":
          if (session.playbackMode !== "page") break;
          e.preventDefault();
          goToPage(session.currentPage - 1);
          break;
        case "nextPage":
          if (session.playbackMode !== "page") break;
          e.preventDefault();
          goToPage(session.currentPage + 1);
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

  function adjustKeyboardSpeed(delta: number) {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    if (currentSession.playbackMode === "page") {
      const dwellMs = getPageDwellMs(currentSession.speed, Math.max(numPagesRef.current, 1));
      if (!dwellMs) return;
      const currentSecondsPerPage = dwellMs / 1000;
      const minSecondsPerPage = (getPageDwellMs(SPEED_MAX, Math.max(numPagesRef.current, 1)) ?? 0) / 1000;
      const maxSecondsPerPage = (getPageDwellMs(SPEED_MIN, Math.max(numPagesRef.current, 1)) ?? 0) / 1000;
      const pageTempoDelta = delta > 0 ? -1 : 1;
      const nextSecondsPerPage = Math.min(
        maxSecondsPerPage,
        Math.max(minSecondsPerPage, currentSecondsPerPage + pageTempoDelta)
      );
      const nextSpeed = Math.min(
        SPEED_MAX,
        Math.max(SPEED_MIN, 1 / (nextSecondsPerPage * Math.max(numPagesRef.current, 1)))
      );
      setSpeed(nextSpeed);
      return;
    }

    if (!currentSession.documentGeometry) return;
    setSpeed(clampDocumentSpeed((currentSession.scrollVelocityPointsPerSecond ?? DOCUMENT_SPEED_DEFAULT) + delta));
  }

  function sendCanonicalControl(
    intent: "resume" | "pause" | "seek" | "restart" | "stop" | "seek-marker" | "set-speed",
    extras: { cursor?: { revision: string; yMicroPoints: number }; markerId?: string; velocityPointsPerSecond?: number } = {}
  ) {
    const current = stateRef.current;
    if (
      !current?.documentGeometry ||
      !current.documentCursor ||
      cursorCommandInFlightRef.current
    ) {
      return;
    }
    cursorCommandInFlightRef.current = true;
    cursorPositionCommandInFlightRef.current =
      intent === "pause" ||
      intent === "seek" ||
      intent === "restart" ||
      intent === "stop" ||
      intent === "seek-marker";
    setErrorMessage(null);
    socket.emit("admin-control", {
      sessionId: id,
      intent,
      revision: current.documentGeometry.revision,
      expectedControlVersion: current.controlVersion ?? 0,
      ...extras,
    });
  }

  function play() {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    // Resuming re-arms auto-stop; the boundary just left is now behind us.
    autoStopEngagedRef.current = false;

    if (currentSession.playbackMode === "scroll") {
      sendCanonicalControl("resume");
      return;
    } else {
      patchSession({
        playing: true,
        status: "live",
        currentPage: currentSession.currentPage,
      });
      socket.emit("admin-play", {
        sessionId: id,
        currentPage: currentSession.currentPage,
      });
    }
  }

  function pause() {
    const currentSession = stateRef.current;
    if (!currentSession) return;

    if (currentSession.playbackMode === "scroll") {
      sendCanonicalControl("pause");
      return;
    } else {
      patchSession({ playing: false, currentPage: currentSession.currentPage });
      socket.emit("admin-pause", {
        sessionId: id,
        currentPage: currentSession.currentPage,
      });
    }
  }

  function stop() {
    if (stateRef.current?.playbackMode === "scroll") {
      sendCanonicalControl("stop");
      return;
    }
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
      sendCanonicalControl("restart");
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

    const cursor = currentSession.documentGeometry
      ? viewer.getDocumentCursor(currentSession.documentGeometry)
      : null;
    if (!cursor) {
      setErrorMessage("document-geometry-unavailable");
      return;
    }
    sendCanonicalControl("seek", { cursor });
  }

  function handleDocumentLoad(pageCount: number): void {
    setNumPages(pageCount);
    const currentSession = stateRef.current;
    if (
      currentSession?.playbackMode === "scroll" &&
      currentSession.documentCursor &&
      currentSession.documentGeometry
    ) {
      viewerRef.current?.scrollToDocumentCursor(
        currentSession.documentCursor,
        currentSession.documentGeometry
      );
    }
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

  function setSpeed(speed: number, opts: { persistToMarker?: boolean } = {}) {
    const { persistToMarker = true } = opts;
    const isCanonicalScroll =
      stateRef.current?.playbackMode === "scroll" && Boolean(stateRef.current.documentGeometry);
    const velocityPointsPerSecond = isCanonicalScroll ? clampDocumentSpeed(speed) : undefined;
    if (velocityPointsPerSecond !== undefined) {
      sendCanonicalControl("set-speed", { velocityPointsPerSecond });
    } else {
      socket.emit("admin-set-speed", { sessionId: id, speed, velocityPointsPerSecond });
    }
    patchSession(
      velocityPointsPerSecond !== undefined
        ? { scrollVelocityPointsPerSecond: velocityPointsPerSecond }
        : { speed }
    );

    // While a song is playing, remember the host's chosen tempo on its marker so
    // it is restored automatically the next time that marker is loaded.
    if (!persistToMarker || !stateRef.current?.playing) return;
    const currentMarker = getCurrentMarker();
    if (!currentMarker) return;
    const markerSpeed = velocityPointsPerSecond ?? speed;
    const markerAlreadyMatches =
      velocityPointsPerSecond !== undefined
        ? currentMarker.scrollVelocityPointsPerSecond === markerSpeed
        : currentMarker.speed === markerSpeed;
    if (markerAlreadyMatches) return;
    const next = (stateRef.current.markers ?? []).map((marker) =>
      marker.id === currentMarker.id
        ? velocityPointsPerSecond !== undefined
          ? { ...marker, scrollVelocityPointsPerSecond: markerSpeed }
          : { ...marker, speed: markerSpeed }
        : marker
    );
    setMarkers(next);
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

  function setBackgroundMode(backgroundMode: SessionBackgroundMode) {
    const currentSession = stateRef.current;
    if (!currentSession || currentSession.backgroundMode === backgroundMode) return;
    patchSession({ backgroundMode });
    socket.emit("admin-set-background-mode", { sessionId: id, backgroundMode });
  }

  function setAutoStopAtSongEnd(autoStopAtSongEnd: boolean) {
    const currentSession = stateRef.current;
    if (!currentSession || currentSession.autoStopAtSongEnd === autoStopAtSongEnd) return;
    patchSession({ autoStopAtSongEnd });
    socket.emit("admin-set-auto-stop-at-song-end", { sessionId: id, autoStopAtSongEnd });
  }

  /** Scroll-mode auto-stop: halt playback the moment this frame's advance
   *  crosses a song boundary, via the normal authoritative pause. The stop
   *  lands one viewport-height before the next song's page top, so the boundary
   *  sits at the bottom of the screen and the finishing song's last page stays
   *  visible. Detection is a crossing test against the previous frame's
   *  progress — NOT `getCurrentPage()`, whose nearest-page rounding flips a
   *  boundary early and would skip it. Page mode is handled server-side in
   *  nextPlaybackPatch. */
  function maybeAutoStopAtSongEnd(prevProgress: number) {
    const currentSession = stateRef.current;
    if (!currentSession?.autoStopAtSongEnd || !currentSession.playing) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const newProgress = liveProgressRef.current;
    if (newProgress <= prevProgress) return;
    const metrics = viewer.getScrollMetrics();
    const markers = (currentSession.markers ?? []).slice().sort((a, b) => a.page - b.page);
    for (const marker of markers) {
      const pageTopProgress =
        viewer.getProgressForPage(marker.page) ??
        clamp01((marker.page - 1) / Math.max(numPagesRef.current, 1));
      if (pageTopProgress <= 0) continue;
      const stopProgress =
        metrics && metrics.maxScrollPx > 0
          ? clamp01(
              (pageTopProgress * metrics.maxScrollPx - metrics.viewportHeightPx) /
                metrics.maxScrollPx
            )
          : pageTopProgress;
      if (stopProgress <= 0) continue;
      if (prevProgress < stopProgress && stopProgress <= newProgress) {
        liveProgressRef.current = stopProgress;
        autoStopEngagedRef.current = true;
        pause();
        return;
      }
    }
  }

  function setMarkers(markers: SongMarker[]) {
    socket.emit("admin-set-markers", { sessionId: id, markers });
  }

  function addMarker(title: string, page: number) {
    if (
      !session ||
      !title.trim() ||
      page < 1 ||
      page > numPages ||
      (session.markers ?? []).some((marker) => marker.page === page)
    ) {
      return;
    }
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

  /** Page the host is currently positioned on, across scroll/page modes. */
  function getCurrentPage() {
    if (stateRef.current?.playbackMode === "page") return stateRef.current.currentPage;

    // Markers are page starts, so derive their page from the top-of-viewport
    // document anchor. `getCurrentPage()` uses nearest-page rounding, which can
    // select the following song while the current page is still on screen.
    return (
      viewerRef.current?.getScrollAnchor()?.page ??
      viewerRef.current?.getCurrentPage() ??
      progressToNearestPage(liveProgressRef.current, Math.max(numPagesRef.current, 1))
    );
  }

  /** The marker whose song is currently playing: the last marker at or before
   *  the current page. Null when positioned before the first marker. */
  function getCurrentMarker(): SongMarker | null {
    const markers = (stateRef.current?.markers ?? []).slice().sort((a, b) => a.page - b.page);
    if (markers.length === 0) return null;
    const currentPage = getCurrentPage();
    let current: SongMarker | null = null;
    for (const marker of markers) {
      if (marker.page <= currentPage) current = marker;
      else break;
    }
    return current;
  }

  async function seekToMarker(marker: SongMarker) {
    const currentSession = stateRef.current;
    if (!numPages || marker.page < 1 || marker.page > numPages) return;
    if (currentSession?.playbackMode === "scroll") {
      sendCanonicalControl("seek-marker", { markerId: marker.id });
      return;
    }
    // Restore the tempo captured for this song, if any, without re-persisting it.
    if (typeof marker.speed === "number" && marker.speed > 0) setSpeed(marker.speed, { persistToMarker: false });
    const viewer = viewerRef.current;
    const resolvedPage =
      (await viewer?.findMarkerPage(marker.title, Math.max(1, marker.page - 1))) ??
      marker.page;
    const page = clampPage(resolvedPage, Math.max(numPages, 1));
    if (currentSession?.playbackMode === "page") {
      if (page !== marker.page && currentSession) {
        const nextMarkers = currentSession.markers.map((entry) =>
          entry.id === marker.id ? { ...entry, page } : entry
        );
        setMarkers(nextMarkers);
      }
      goToPage(page);
      pause();
      return;
    }
    const scrollAnchor = { page, fraction: 0 };
    const progress =
      viewer?.getProgressForAnchor(scrollAnchor) ??
      viewer?.getProgressForPage(page) ??
      clamp01((page - 1) / Math.max(numPages, 1));
    liveProgressRef.current = progress;
    lastWallRef.current = Date.now();
    viewer?.scrollToAnchor(scrollAnchor);
    patchSession({ progress, scrollAnchor, playing: false });
    setUiProgress(
      getPlaybackDisplayProgress(currentSession?.playbackMode ?? "scroll", progress, currentSession?.currentPage ?? 1, numPages)
    );
    if (page !== marker.page && currentSession) {
      const nextMarkers = currentSession.markers.map((entry) =>
        entry.id === marker.id ? { ...entry, page } : entry
      );
      setMarkers(nextMarkers);
    }
    socket.emit("admin-pause", { sessionId: id, progress, scrollAnchor });
  }

  function jumpToNextMarker() {
    const markers = (stateRef.current?.markers ?? []).slice().sort((a, b) => a.page - b.page);
    if (markers.length === 0) return;

    const currentPage = getCurrentPage();
    const nextMarker = markers.find((marker) => marker.page > currentPage) ?? markers[0];
    seekToMarker(nextMarker);
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
    setErrorMessage(null);
    try {
      const updated = await api.uploadPdf(id, file, stateRef.current?.documentDescription);
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
      setMarkerSuggestionSet(null);
      setAnnouncement(t("control.uploadCompleteAnnouncement"));
    } catch (error) {
      if (error instanceof ApiError && error.message === "document-description-required") {
        setErrorMessage(t("control.documentDescriptionRequired"));
      } else {
        setErrorMessage(t("control.uploadFailed"));
      }
    } finally {
      setUploading(false);
    }
  }

  async function updateSessionDetails(title: string, description: string) {
    setSavingSessionDetails(true);
    setErrorMessage(null);
    try {
      const updated = await api.updateSessionDetails(id, { title, description });
      stateRef.current = updated;
      setSession(updated);
      setAnnouncement(t("control.sessionDetailsSaved"));
    } catch (error) {
      if (error instanceof ApiError && error.message === "title-required") {
        setErrorMessage(t("control.sessionTitleRequired"));
      } else {
        setErrorMessage(t("control.sessionDetailsSaveFailed"));
      }
    } finally {
      setSavingSessionDetails(false);
    }
  }

  async function updateDocumentDescription(documentDescription: string) {
    setSavingDocumentDescription(true);
    setErrorMessage(null);
    try {
      const updated = await api.updateSessionDetails(id, { documentDescription });
      stateRef.current = updated;
      setSession(updated);
      setAnnouncement(t("control.documentDescriptionSaved"));
    } catch {
      setErrorMessage(t("control.documentDescriptionSaveFailed"));
    } finally {
      setSavingDocumentDescription(false);
    }
  }

  async function generateMarkers() {
    setGeneratingMarkers(true);
    setErrorMessage(null);
    try {
      const next = await api.generateMarkers(id);
      setMarkerSuggestionSet(next);
      setGeneratingMarkers(next.status === "running");
      setAnnouncement(t("control.aiMarkersStarted"));
    } catch (error) {
      setGeneratingMarkers(false);
      if (error instanceof ApiError) {
        setErrorMessage(error.detailMessage || t("control.aiMarkersFailed"));
      } else {
        setErrorMessage(t("control.aiMarkersFailed"));
      }
    }
  }

  async function applyMarkerSuggestions(suggestions: MarkerSuggestion[]) {
    setErrorMessage(null);
    try {
      const updated = await api.applyMarkerSuggestions(id, suggestions);
      stateRef.current = updated;
      setSession(updated);
      setMarkerSuggestionSet(null);
      setAnnouncement(t("control.aiMarkersApplied"));
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.detailMessage || t("control.aiMarkersApplyFailed"));
      } else {
        setErrorMessage(t("control.aiMarkersApplyFailed"));
      }
    }
  }

  async function discardMarkerSuggestions() {
    setErrorMessage(null);
    try {
      await api.deleteMarkerSuggestions(id);
      setMarkerSuggestionSet(null);
      setAnnouncement(t("control.aiMarkersDiscarded"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setMarkerSuggestionSet(null);
        return;
      }
      setErrorMessage(t("control.aiMarkersDiscardFailed"));
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
  const fullscreenBlackBackground =
    distractionFree && session?.backgroundMode === "black";

  return (
    <main
      id="main-content"
      className={cn(
        "mx-auto w-full flex-1",
        distractionFree
          ? cn("max-w-none p-0", fullscreenBlackBackground && "bg-black text-white")
          : "max-w-7xl px-4 pt-4 pb-8 sm:px-6"
      )}
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {errorMessage && !distractionFree && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
        >
          {errorMessage}
        </div>
      )}
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        aria-label={t("control.addPdf")}
        tabIndex={-1}
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
            distractionFree &&
              (fullscreenBlackBackground
                ? "rounded-none border-0 bg-black text-white shadow-none"
                : "rounded-none border-0 bg-transparent shadow-none"),
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
                <>
                  <p id="admin-document-description" className="sr-only">
                    {session.documentDescription || t("viewer.documentDescriptionFallback")}
                  </p>
                  <PdfViewer
                    key={session.pdfUrl}
                    ref={viewerRef}
                    fileUrl={session.pdfUrl}
                    documentDescription={session.documentDescription}
                    regionLabel={t("control.documentRegionLabel", { title: session.title })}
                    describedById="admin-document-description"
                    backgroundMode={session.backgroundMode}
                    flush={!distractionFree}
                    edgeToEdge={distractionFree}
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
                    onDocumentLoad={handleDocumentLoad}
                  />
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                  <FileWarning className="size-7" />
                  <p className="font-medium">{t("control.noPdfTitle")}</p>
                  <p className="max-w-md text-sm">{t("control.noPdfDesc")}</p>
                </div>
              )}
            </div>

            {distractionFree && (session.markers ?? []).length > 0 && (
              <div
                className={cn(
                  "absolute right-3 top-3 z-10 max-h-[calc(100%-6rem)] w-52 overflow-y-auto rounded-xl p-2 shadow-[var(--shadow-lift)] backdrop-blur-md",
                  fullscreenBlackBackground
                    ? "border border-white/10 bg-black/88 text-white"
                    : "border border-border/60 bg-background/88"
                )}
              >
                <div
                  className={cn(
                    "mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                    fullscreenBlackBackground ? "text-white/58" : "text-muted-foreground"
                  )}
                >
                  {t("controls.setlist")}
                </div>
                <div className="flex flex-col gap-0.5">
                  {(session.markers ?? []).map((marker) => (
                    <button
                      key={marker.id}
                      type="button"
                      onClick={() => seekToMarker(marker)}
                      className={cn(
                        "flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        fullscreenBlackBackground ? "hover:bg-white/8" : "hover:bg-muted"
                      )}
                    >
                      <Music
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          fullscreenBlackBackground ? "text-white/58" : "text-muted-foreground"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{marker.title}</span>
                      <span
                        className={cn(
                          "font-mono text-xs",
                          fullscreenBlackBackground ? "text-white/58" : "text-muted-foreground"
                        )}
                      >
                        {marker.page}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!distractionFree && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 hidden justify-center px-3 lg:flex">
                <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/90 px-3 py-2 shadow-[var(--shadow-lift)] backdrop-blur-md">
                  {session.playbackMode === "page" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToPage(session.currentPage - 1)}
                        disabled={session.currentPage <= 1}
                        className="min-w-[8.5rem] justify-center"
                      >
                        <ChevronLeft className="size-4" />
                        {t("controls.previousPage")}
                      </Button>
                      <div className="rounded-xl bg-muted px-3 py-2 text-sm font-semibold tabular-nums text-foreground">
                        {Math.min(Math.max(session.currentPage, 1), Math.max(numPages, 1))} /{" "}
                        {Math.max(numPages, 1)}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToPage(session.currentPage + 1)}
                        disabled={numPages > 0 && session.currentPage >= numPages}
                        className="min-w-[8.5rem] justify-center"
                      >
                        {t("controls.nextPage")}
                        <ChevronRight className="size-4" />
                      </Button>
                    </>
                  )}

                  <div className="h-8 w-px bg-border/70" aria-hidden="true" />

                  {session.playing ? (
                    <Button variant="warning" size="sm" onClick={pause} className="justify-center">
                      <Pause className="size-4" />
                      {t("controls.pause")}
                    </Button>
                  ) : (
                    <Button variant="success" size="sm" onClick={play} className="justify-center">
                      <Play className="size-4" />
                      {t("controls.play")}
                    </Button>
                  )}

                  <Button variant="outline" size="sm" onClick={restart} className="justify-center">
                    <SkipBack className="size-4" />
                    {t("controls.startOver")}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={seekToCurrent}
                    className="justify-center"
                  >
                    <Crosshair className="size-4" />
                    {t("controls.here")}
                  </Button>
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
                hidePrimaryControlsOnDesktop
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
              markerGenerationAvailable={markerGenerationAvailable}
              generatingMarkers={generatingMarkers}
              markerSuggestionSet={markerSuggestionSet}
              onAddMarker={addMarker}
              onDeleteMarker={deleteMarker}
              onGenerateMarkers={generateMarkers}
              onApplyMarkerSuggestions={applyMarkerSuggestions}
              onDiscardMarkerSuggestions={discardMarkerSuggestions}
              onOpenFilePicker={() => pdfInput.current?.click()}
              onSeekToMarker={seekToMarker}
              onSetPlaybackMode={setPlaybackMode}
              onSetBackgroundMode={setBackgroundMode}
              onSetAutoStopAtSongEnd={setAutoStopAtSongEnd}
              onUpdateSessionDetails={updateSessionDetails}
              onUpdateDocumentDescription={updateDocumentDescription}
              onShortcutBindingChange={handleShortcutBindingChange}
              onShortcutPresetChange={handleShortcutPresetChange}
              savingSessionDetails={savingSessionDetails}
              savingDocumentDescription={savingDocumentDescription}
              shortcutBindings={shortcutBindings}
              shortcutPreset={shortcutPreset}
            />
          </div>
        )}
      </div>

      {!distractionFree && (
        <button
          type="button"
          onClick={async () => {
            setDistractionFree(true);
            if (!document.fullscreenEnabled) return;
            try {
              if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
              }
            } catch {
              // Fullscreen request may be denied; keep the UI state change.
            }
          }}
          className="fixed bottom-4 right-4 z-50 inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[var(--shadow-lift)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("control.hideUi")}
          aria-label={t("control.hideUi")}
        >
          <Maximize className="size-5" />
        </button>
      )}
    </main>
  );
}

function hasMarkerGenerationCapability(config: AiConfigResponse): boolean {
  if (!config.activeProvider) return false;
  const active = config.configs.find((item) => item.provider === config.activeProvider);
  return Boolean(active?.capabilities.includes("marker-generation"));
}
