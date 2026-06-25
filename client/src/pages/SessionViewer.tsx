import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  AudioLines,
  FileX2,
  Loader2,
  Maximize,
  OctagonX,
} from "lucide-react";
import { api } from "@/api/client";
import { PdfViewer, type PdfViewerHandle } from "@/components/PdfViewer";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { reportError } from "@/lib/errorLog";
import { getPlaybackDisplayProgress } from "@/lib/playback";
import {
  shouldAcceptSessionState,
  shouldSnapToSessionState,
  type ViewerConnectionPhase,
} from "@/lib/sessionSync";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useWakeLock } from "@/lib/useWakeLock";
import { cn } from "@/lib/utils";
import { getSocket, useSocketStatus } from "@/sockets/socket";
import { effectiveProgressFromElapsed, type SessionState } from "@/types/session";

export function SessionViewer() {
  const { code = "" } = useParams();
  const { t } = useI18n();
  const socketStatus = useSocketStatus();
  const [session, setSession] = useState<SessionState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [ended, setEnded] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [distractionFree, setDistractionFree] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [connectionPhase, setConnectionPhase] = useState<ViewerConnectionPhase>("syncing");

  const viewerRef = useRef<PdfViewerHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const displayedRef = useRef(0);
  const receivedAtRef = useRef(Date.now());
  const numPagesRef = useRef(0);
  const lastStateVersionRef = useRef(-1);
  const hasEverConnectedLiveRef = useRef(false);
  const awaitingSocketSnapshotRef = useRef(false);

  useDocumentTitle(session?.title || (code ? `Session ${code}` : null));
  useWakeLock(true);

  useEffect(() => {
    stateRef.current = session;
  }, [session]);

  useEffect(() => {
    numPagesRef.current = numPages;
  }, [numPages]);

  const syncUiFromState = (nextSession: SessionState) => {
    setUiProgress(
      getPlaybackDisplayProgress(
        nextSession.playbackMode,
        nextSession.progress,
        nextSession.currentPage,
        numPagesRef.current
      )
    );
  };

  useEffect(() => {
    const handler = () => {
      setDistractionFree(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const onState = (nextSession: SessionState) => {
      if (nextSession.code !== code) return;
      if (
        !shouldAcceptSessionState(
          lastStateVersionRef.current,
          nextSession,
          awaitingSocketSnapshotRef.current
        )
      ) {
        return;
      }

      const previousSession = stateRef.current;
      receivedAtRef.current = Date.now();
      lastStateVersionRef.current = nextSession.stateVersion;
      hasEverConnectedLiveRef.current = true;
      awaitingSocketSnapshotRef.current = false;
      stateRef.current = nextSession;
      setSession(nextSession);
      setNotFound(false);
      setEnded(nextSession.status === "ended");
      setConnectionPhase("connected");

      if (nextSession.playbackMode === "scroll") {
        if (
          shouldSnapToSessionState(previousSession, nextSession, displayedRef.current)
        ) {
          displayedRef.current = nextSession.progress;
          viewerRef.current?.scrollToProgress(nextSession.progress);
          setUiProgress(nextSession.progress);
        }
      } else {
        viewerRef.current?.scrollToPage(nextSession.currentPage);
        syncUiFromState(nextSession);
      }
    };

    const onEnded = () => setEnded(true);
    const onNotFound = (payload: { code?: string }) => {
      if (!payload?.code || payload.code === code) setNotFound(true);
    };

    socket.on("session-state", onState);
    socket.on("session-ended", onEnded);
    socket.on("session-not-found", onNotFound);

    api
      .sessionByCode(code)
      .then((nextSession) => {
        if (!shouldAcceptSessionState(lastStateVersionRef.current, nextSession)) return;
        receivedAtRef.current = Date.now();
        lastStateVersionRef.current = nextSession.stateVersion;
        stateRef.current = nextSession;
        setSession(nextSession);
        displayedRef.current = nextSession.progress;
        syncUiFromState(nextSession);
        setEnded(nextSession.status === "ended");
      })
      .catch(() => setNotFound(true));

    return () => {
      socket.emit("leave-session");
      socket.off("session-state", onState);
      socket.off("session-ended", onEnded);
      socket.off("session-not-found", onNotFound);
    };
  }, [code]);

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    let loggedError = false;

    const tick = () => {
      try {
        const currentSession = stateRef.current;
        const viewer = viewerRef.current;
        if (currentSession && viewer && currentSession.playbackMode === "scroll") {
          const elapsed = currentSession.playing ? Date.now() - receivedAtRef.current : 0;
          const target = effectiveProgressFromElapsed(currentSession, elapsed);
          const current = displayedRef.current;
          const diff = target - current;
          const next = Math.abs(diff) > 0.04 ? target : current + diff * 0.18;
          displayedRef.current = next;
          viewer.scrollToProgress(next);
          if (frame++ % 10 === 0) setUiProgress(next);
        }
      } catch (err) {
        if (!loggedError) {
          loggedError = true;
          reportError("viewer.syncLoop", err);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    if (socketStatus.state === "connected") {
      awaitingSocketSnapshotRef.current = true;
      setConnectionPhase("syncing");
      socket.emit("join-session", code);
      socket.emit("request-session-state", code);
      return;
    }

    if (hasEverConnectedLiveRef.current) {
      setConnectionPhase("disconnected");
      return;
    }

    setConnectionPhase("syncing");
  }, [code, socketStatus.state]);

  useEffect(() => {
    const socket = getSocket();

    const requestSnapshot = () => {
      if (socket.connected) {
        awaitingSocketSnapshotRef.current = true;
        setConnectionPhase("syncing");
        socket.emit("request-session-state", code);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") requestSnapshot();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", requestSnapshot);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", requestSnapshot);
    };
  }, [code]);

  useEffect(() => {
    const currentSession = stateRef.current;
    const viewer = viewerRef.current;
    if (!currentSession || !viewer || currentSession.playbackMode !== "page") return;
    viewer.scrollToPage(currentSession.currentPage);
    syncUiFromState(currentSession);
  }, [numPages, session?.currentPage, session?.pdfUrl, session?.playbackMode, session?.progress]);

  const playing = session?.playing ?? false;
  const pageMode = session?.playbackMode === "page";
  const blackBackground = session?.backgroundMode === "black";
  const reserveChromeSpace = pageMode && !distractionFree && !chromeHidden;

  useEffect(() => {
    if (!playing) {
      setChromeHidden(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      setChromeHidden(false);
      clearTimeout(timer);
      timer = setTimeout(() => setChromeHidden(true), 2500);
    };
    arm();
    const events = ["pointerdown", "pointermove", "keydown", "touchstart"];
    events.forEach((eventName) =>
      window.addEventListener(eventName, arm, { passive: true })
    );
    return () => {
      clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, arm));
    };
  }, [playing]);

  if (notFound) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
          <FileX2 className="size-7" />
        </span>
        <h1 className="font-heading text-2xl font-bold">
          {t("viewer.notFoundTitle")}
        </h1>
        <p className="text-muted-foreground">
          {t("viewer.notFoundDesc", { code })}
        </p>
        <Button asChild variant="secondary">
          <Link to="/">
            <ArrowLeft />
            {t("common.backToOverview")}
          </Link>
        </Button>
      </main>
    );
  }

  const pdfUrl = session?.pdfUrl || "";
  const showConnectionBanner =
    connectionPhase === "disconnected" ||
    (connectionPhase === "syncing" && session !== null);
  const connectionAnnouncement =
    ended
      ? t("viewer.endedBanner")
      : connectionPhase === "disconnected"
        ? t("viewer.reconnecting")
        : connectionPhase === "syncing" && session !== null
          ? t("viewer.syncing")
          : connectionPhase === "connected" && session !== null
            ? t("viewer.syncComplete")
            : "";

  return (
    <main
      id="main-content"
      aria-labelledby="session-viewer-title"
      className={cn(
        "flex h-dvh flex-col overflow-hidden",
        blackBackground ? "bg-black text-white" : "bg-muted/40"
      )}
    >
      <h1 id="session-viewer-title" className="sr-only">
        {session?.title ?? t("viewer.loading")}
      </h1>
      <div aria-live="polite" className="sr-only">
        {connectionAnnouncement}
      </div>

      {!distractionFree && !chromeHidden && (
        <header
          className={cn(
            "absolute inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)]",
            blackBackground
              ? "border-b border-white/10 bg-black/96 text-white backdrop-blur-none"
              : "border-b border-border/60 bg-background/85 backdrop-blur-md"
          )}
        >
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-3 sm:px-6">
            <Link
              to="/"
              aria-label={t("viewer.backAria")}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-soft)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <AudioLines className="size-5" />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-sm font-semibold leading-tight sm:text-base">
                {session?.title ?? t("viewer.loading")}
              </p>
              <span
                className={cn(
                  "font-mono text-xs",
                  blackBackground ? "text-white/58" : "text-muted-foreground"
                )}
              >
                {code}
              </span>
            </div>
            <ConnectionStatus playing={session?.playing} phase={connectionPhase} />
          </div>

          <div
            role="progressbar"
            aria-label={t("controls.positionAria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(uiProgress * 100)}
            aria-valuetext={`${Math.round(uiProgress * 100)}%`}
            className={cn("h-1 w-full", blackBackground ? "bg-white/10" : "bg-muted")}
          >
            <div
              className="h-full bg-primary transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.round(uiProgress * 100)}%` }}
            />
          </div>
        </header>
      )}

      {!distractionFree && (ended || showConnectionBanner) && (
        <div
          className={cn(
            "absolute inset-x-0 z-30 mx-auto w-full max-w-6xl px-3 sm:px-6",
            chromeHidden
              ? "top-[calc(env(safe-area-inset-top)+0.75rem)]"
              : "top-[calc(3.75rem+env(safe-area-inset-top))]"
          )}
        >
          {ended && (
            <Banner tone="muted" icon={<OctagonX className="size-4" />}>
              {t("viewer.endedBanner")}
            </Banner>
          )}
          {connectionPhase === "syncing" && session !== null && (
            <Banner tone="warning" icon={<Loader2 className="size-4 animate-spin" />}>
              {t("viewer.syncing")}
            </Banner>
          )}
          {connectionPhase === "disconnected" && (
            <Banner tone="warning" icon={<Loader2 className="size-4 animate-spin" />}>
              {t("viewer.reconnecting")}
            </Banner>
          )}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div
          className={cn(
            "h-full",
            reserveChromeSpace &&
              "pt-[calc(3.5rem+env(safe-area-inset-top)+0.75rem)] pb-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)]"
          )}
        >
          {pdfUrl ? (
            <>
              <p id="session-document-description" className="sr-only">
                {session?.documentDescription || t("viewer.documentDescriptionFallback")}
              </p>
              <PdfViewer
                key={pdfUrl}
                ref={viewerRef}
                fileUrl={pdfUrl}
                documentDescription={session?.documentDescription}
                regionLabel={t("viewer.documentRegionLabel", { title: session?.title ?? code })}
                describedById="session-document-description"
                backgroundMode={session?.backgroundMode ?? "light"}
                edgeToEdge={distractionFree}
                visiblePage={pageMode ? session.currentPage : undefined}
                blockUserScroll
                onDocumentLoad={setNumPages}
              />
            </>
          ) : (
            <div
              className={cn(
                "flex h-full items-center justify-center p-8 text-center",
                blackBackground ? "text-white/60" : "text-muted-foreground"
              )}
            >
              {t("viewer.noPdf")}
            </div>
          )}
        </div>
      </div>

      {!distractionFree && !chromeHidden && <Footer inverse={blackBackground} />}

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
          className={cn(
            "fixed bottom-4 right-4 z-50 inline-flex size-11 items-center justify-center rounded-full border shadow-[var(--shadow-lift)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            blackBackground
              ? "border-white/10 bg-black text-white hover:bg-neutral-900"
              : "border-border bg-card text-foreground hover:bg-muted"
          )}
          title={t("control.hideUi")}
          aria-label={t("control.hideUi")}
        >
          <Maximize className="size-5" />
        </button>
      )}
    </main>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "muted" | "warning";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    muted: "border-border bg-secondary/60 text-secondary-foreground",
    warning: "border-warning/30 bg-warning/10 text-warning",
  };
  return (
    <div
      role="status"
      className={`mb-1 flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-medium ${tones[tone]}`}
    >
      {icon}
      {children}
    </div>
  );
}
