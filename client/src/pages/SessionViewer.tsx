import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AudioLines, FileX2, Loader2, OctagonX } from "lucide-react";
import { api } from "@/api/client";
import { getSocket } from "@/sockets/socket";
import { PdfViewer, type PdfViewerHandle } from "@/components/PdfViewer";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { effectiveProgress, type SessionState } from "@/types/session";

export function SessionViewer() {
  const { code = "" } = useParams();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [ended, setEnded] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);
  const [chromeHidden, setChromeHidden] = useState(false);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const displayedRef = useRef<number>(0);

  useDocumentTitle(session?.title || (code ? `Session ${code}` : null));

  useEffect(() => {
    stateRef.current = session;
  }, [session]);

  // ---- Socket wiring ----
  useEffect(() => {
    const socket = getSocket();
    const join = () => {
      socket.emit("join-session", code);
      socket.emit("request-session-state", code);
    };
    const onConnect = () => {
      setConnected(true);
      join();
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: SessionState) => {
      if (s.code === code) {
        setSession(s);
        setNotFound(false);
        if (s.status === "ended") setEnded(true);
      }
    };
    const onEnded = () => setEnded(true);
    const onNotFound = (p: { code?: string }) => {
      if (!p?.code || p.code === code) setNotFound(true);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("session-state", onState);
    socket.on("session-ended", onEnded);
    socket.on("session-not-found", onNotFound);
    if (socket.connected) onConnect();

    api
      .sessionByCode(code)
      .then((s) => {
        setSession(s);
        if (s.status === "ended") setEnded(true);
      })
      .catch(() => setNotFound(true));

    return () => {
      socket.emit("leave-session");
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("session-state", onState);
      socket.off("session-ended", onEnded);
      socket.off("session-not-found", onNotFound);
    };
  }, [code]);

  // ---- Sync loop: ease toward the conductor's progress, snap on big jumps ----
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const s = stateRef.current;
      const viewer = viewerRef.current;
      if (s && viewer) {
        const target = effectiveProgress(s);
        const current = displayedRef.current;
        const diff = target - current;
        const next = Math.abs(diff) > 0.04 ? target : current + diff * 0.18;
        displayedRef.current = next;
        viewer.scrollToProgress(next);
        if (frame++ % 10 === 0) setUiProgress(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Immersive chrome: while playing, auto-hide the bar + footer after a
  // short idle so the score gets the full screen. Any interaction reveals them
  // again (and re-arms the timer), so the user is never trapped.
  const playing = session?.playing ?? false;
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
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
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

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-muted/40">
      {/* Single merged bar: brand/home + title + status + progress. Auto-hides
          while playing. */}
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-20 border-b border-border/60 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-transform duration-300 ease-out",
          chromeHidden && "-translate-y-full"
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
            <span className="font-mono text-xs text-muted-foreground">{code}</span>
          </div>
          <ConnectionStatus connected={connected} playing={session?.playing} />
        </div>

        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.round(uiProgress * 100)}%` }}
          />
        </div>
      </header>

      {/* Status banners (kept visible — they only appear on problems). */}
      {(ended || !connected) && (
        <div className="absolute inset-x-0 top-[calc(3.75rem+env(safe-area-inset-top))] z-30 mx-auto w-full max-w-6xl px-3 sm:px-6">
          {ended && (
            <Banner tone="muted" icon={<OctagonX className="size-4" />}>
              {t("viewer.endedBanner")}
            </Banner>
          )}
          {!connected && (
            <Banner tone="warning" icon={<Loader2 className="size-4 animate-spin" />}>
              {t("viewer.reconnecting")}
            </Banner>
          )}
        </div>
      )}

      {/* Document area: sits between the header and footer so the footer is not
          sticky/overlaying the score. */}
      <div className="relative flex-1 overflow-hidden">
        {pdfUrl ? (
          <PdfViewer key={pdfUrl} ref={viewerRef} fileUrl={pdfUrl} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
            {t("viewer.noPdf")}
          </div>
        )}
      </div>

      {/* Footer sits at the bottom of the page and auto-hides while playing. */}
      <div
        className={cn(
          "shrink-0 z-20 border-t border-border/60 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-transform duration-300 ease-out",
          chromeHidden && "translate-y-full"
        )}
      >
        <Footer />
      </div>
    </div>
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
