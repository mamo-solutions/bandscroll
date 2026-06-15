import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileX2, Loader2, OctagonX } from "lucide-react";
import { api } from "@/api/client";
import { getSocket } from "@/sockets/socket";
import { PdfViewer, type PdfViewerHandle } from "@/components/PdfViewer";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { effectiveProgress, type SessionState } from "@/types/session";

export function SessionViewer() {
  const { code = "" } = useParams();
  const { t } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [ended, setEnded] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const stateRef = useRef<SessionState | null>(null);
  const displayedRef = useRef<number>(0);

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

  if (notFound) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
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
    <div className="flex min-h-[calc(100dvh-4rem)] flex-1 flex-col">
      {/* Sub-header */}
      <div className="sticky top-16 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label={t("viewer.backAria")}
            >
              <Link to="/">
                <ArrowLeft />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="truncate font-heading font-semibold leading-tight">
                {session?.title ?? t("viewer.loading")}
              </p>
              <span className="font-mono text-xs text-muted-foreground">{code}</span>
            </div>
          </div>
          <ConnectionStatus connected={connected} playing={session?.playing} />
        </div>

        {/* Live progress */}
        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.round(uiProgress * 100)}%` }}
          />
        </div>
      </div>

      {/* Banners */}
      {(ended || !connected) && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6">
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

      {/* PDF */}
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-2 py-3 sm:px-6">
        <div className="h-full overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          {pdfUrl ? (
            <PdfViewer key={pdfUrl} ref={viewerRef} fileUrl={pdfUrl} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
              {t("viewer.noPdf")}
            </div>
          )}
        </div>
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
