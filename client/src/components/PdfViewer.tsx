import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { SessionBackgroundMode } from "@/types/session";

// Errors-only verbosity: silences harmless "TT: undefined function" font
// warnings from PDF.js. Module-level constant so react-pdf doesn't reload.
const DOCUMENT_OPTIONS = { verbosity: pdfjs.VerbosityLevel.ERRORS };

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

// PDF pages are rasterized once at this fixed bitmap width and then fit to the
// container with CSS (.pdf-page-fit). Keeping the render width constant means an
// orientation change never re-rasterizes the canvases.
const RENDER_WIDTH = 1000;
// Cap the device pixel ratio so pages don't exhaust memory on high-DPI phones.
const PAGE_DPR =
  typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;

// Virtualization: only pages within the viewport (+/- OVERSCAN) are rendered as
// canvases; the rest are reserved-height placeholders. This caps canvas memory
// to a handful of pages — rendering a whole 40+ page PDF at once crashes iOS
// Safari (a few hundred MB tab limit).
const OVERSCAN = 2;
const PAGE_GAP = 12; // matches the flex `gap-3` between page wrappers
const PAGE_TOP = 12; // matches `pt-3` top padding

export type PdfViewerHandle = {
  scrollToProgress: (progress: number) => void;
  scrollToPage: (page: number) => void;
  getProgressForPage: (page: number) => number;
  getCurrentPage: () => number;
  getCurrentProgress: () => number;
  readonly numPages: number;
};

type Props = {
  fileUrl: string;
  backgroundMode?: SessionBackgroundMode;
  edgeToEdge?: boolean;
  /** When set, render only this page instead of the full scrollable document. */
  visiblePage?: number;
  /** Called (already DOM-throttled by rAF) when the user scrolls manually. */
  onUserScroll?: (progress: number) => void;
  /** Called when a PDF finishes loading with its page count. */
  onDocumentLoad?: (numPages: number) => void;
  /** When true, all user-initiated scroll input (wheel, touch, keys) is blocked.
   *  Programmatic scrolling via scrollToProgress still works. */
  blockUserScroll?: boolean;
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  {
    fileUrl,
    backgroundMode = "light",
    edgeToEdge = false,
    visiblePage,
    onUserScroll,
    onDocumentLoad,
    blockUserScroll,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [numPages, setNumPages] = useState(0);
  // CSS display width of each page/image wrapper (responsive).
  const [displayWidth, setDisplayWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(0);
  // Page aspect ratio (height / width), measured from the first page. Pages in a
  // setlist PDF are uniform, so one value reserves space for all of them.
  const [aspect, setAspect] = useState<number | null>(null);
  const aspectRef = useRef<number | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const rafPending = useRef(false);
  const readyRef = useRef(false);
  const { t } = useI18n();

  const isImage = IMAGE_RE.test(fileUrl);
  const singlePageMode = visiblePage !== undefined;
  const clampedVisiblePage = clampPage(visiblePage ?? 1, numPages);
  const useBlackCanvasChrome = backgroundMode === "black" && singlePageMode;

  // Reset everything whenever the file changes (initial load or swap).
  useEffect(() => {
    setLoading(true);
    setError(null);
    setNumPages(0);
    setAspect(null);
    aspectRef.current = null;
    setRange({ start: 0, end: 0 });
    pageRefs.current = [];
    readyRef.current = false;
  }, [fileUrl]);

  // Ready = safe to drive programmatic scrolling. Avoids scrolling before the
  // document has real geometry (which the conductor's loop would otherwise spam).
  useEffect(() => {
    readyRef.current = isImage ? !loading : aspect != null;
  }, [isImage, loading, aspect]);

  const reservedHeight = aspect ? Math.max(1, Math.round(displayWidth * aspect)) : undefined;
  const singlePageWidth =
    singlePageMode && aspect && containerHeight > 0
      ? Math.max(
          280,
          Math.min(displayWidth, Math.floor((containerHeight - (edgeToEdge ? 0 : 24)) / aspect))
        )
      : displayWidth;

  const maxScroll = () => {
    if (singlePageMode) return 1;
    const el = scrollRef.current;
    if (!el) return 0;
    return Math.max(1, el.scrollHeight - el.clientHeight);
  };

  const getProgressForPage = (page: number) => {
    if (singlePageMode || !pageRefs.current[page - 1]) return pageProgress(page, numPages);
    const el = scrollRef.current;
    const pageEl = pageRefs.current[page - 1];
    if (!el || !pageEl) return 0;
    return clamp01(pageEl.offsetTop / maxScroll());
  };

  const getCurrentPage = () => {
    if (singlePageMode) return clampedVisiblePage;
    const el = scrollRef.current;
    if (!el || numPages <= 1) return 1;

    let nearestPage = 1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < numPages; index++) {
      const pageEl = pageRefs.current[index];
      if (!pageEl) continue;
      const distance = Math.abs(pageEl.offsetTop - el.scrollTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = index + 1;
      }
    }
    return nearestPage;
  };

  useImperativeHandle(
    ref,
    () => ({
      scrollToProgress(progress: number) {
        const el = scrollRef.current;
        if (!el || !readyRef.current) return;
        if (singlePageMode) {
          el.scrollTop = 0;
          return;
        }
        el.scrollTop = clamp01(progress) * maxScroll();
      },
      scrollToPage(page: number) {
        const el = scrollRef.current;
        if (!el) return;
        if (singlePageMode) {
          el.scrollTop = 0;
          return;
        }
        const pageEl = pageRefs.current[page - 1];
        if (!pageEl) return;
        el.scrollTop = pageEl.offsetTop;
      },
      getProgressForPage,
      getCurrentPage,
      getCurrentProgress() {
        if (singlePageMode) return pageProgress(clampedVisiblePage, numPages);
        const el = scrollRef.current;
        if (!el) return 0;
        return clamp01(el.scrollTop / maxScroll());
      },
      get numPages() {
        return numPages;
      },
    }),
    [clampedVisiblePage, getProgressForPage, numPages, singlePageMode]
  );

  // Responsive display width — only drives CSS sizing of already-rasterized
  // pages, so reacting to it is cheap (no PDF.js re-render on resize/rotate).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const inset = edgeToEdge ? 0 : 24;
      const w = Math.min(RENDER_WIDTH, el.clientWidth - inset);
      setDisplayWidth(Math.max(280, w));
      setContainerHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [edgeToEdge]);

  // Compute which pages should be mounted based on the current scroll position.
  const updateRange = useCallback(() => {
    if (singlePageMode) {
      const index = Math.max(0, clampedVisiblePage - 1);
      setRange({ start: index, end: index });
      return;
    }
    const el = scrollRef.current;
    if (!el || aspect == null || numPages === 0) return;
    const row = Math.max(1, Math.round(displayWidth * aspect)) + PAGE_GAP;
    const top = el.scrollTop - PAGE_TOP;
    const start = Math.max(0, Math.floor(top / row) - OVERSCAN);
    const end = Math.min(numPages - 1, Math.floor((top + el.clientHeight) / row) + OVERSCAN);
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, [aspect, clampedVisiblePage, numPages, displayWidth, singlePageMode]);

  // Recompute the visible window when geometry changes.
  useEffect(() => {
    updateRange();
  }, [updateRange]);

  // Block user-initiated scrolling on read-only viewers so it can't fight the
  // conductor's auto-scroll.
  useEffect(() => {
    if (!blockUserScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    const preventKey = (e: KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(
          e.key
        )
      ) {
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", prevent, { passive: false });
    el.addEventListener("touchmove", prevent, { passive: false });
    window.addEventListener("keydown", preventKey);
    return () => {
      el.removeEventListener("wheel", prevent);
      el.removeEventListener("touchmove", prevent);
      window.removeEventListener("keydown", preventKey);
    };
  }, [blockUserScroll]);

  const handleScroll = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      updateRange();
      const el = scrollRef.current;
      if (onUserScroll && el) {
        onUserScroll(singlePageMode ? pageProgress(clampedVisiblePage, numPages) : clamp01(el.scrollTop / maxScroll()));
      }
    });
  }, [clampedVisiblePage, numPages, onUserScroll, singlePageMode, updateRange]);

  const centerMsg = "flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground";

  const spinner = (
    <div className={centerMsg}>
      <Loader2 className="size-8 animate-spin" />
      <span className="text-sm">{t("viewer.loadingFile")}</span>
    </div>
  );

  return (
    <div
      className={cn(
        "relative h-full",
        backgroundMode === "black" ? "bg-black" : "bg-muted/40",
        blockUserScroll
          ? "overflow-hidden overscroll-none touch-none"
          : "scrollbar-warm overflow-y-auto"
      )}
      ref={scrollRef}
      onScroll={handleScroll}
    >
      {error ? (
        <div className={centerMsg}>{t("viewer.fileError")}</div>
      ) : isImage ? (
        <div
          className={cn(
            "flex flex-col items-center",
            edgeToEdge ? "px-0 pt-0" : "px-2 pt-3 sm:px-4",
            singlePageMode
              ? cn("h-full justify-center", edgeToEdge ? "pb-0" : "pb-3")
              : edgeToEdge
                ? "pb-0"
                : "pb-[55vh]"
          )}
        >
          {loading && (
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center",
                backgroundMode === "black" ? "bg-black" : "bg-muted/40"
              )}
            >
              {spinner}
            </div>
          )}
          <div
            ref={(el) => {
              pageRefs.current[0] = el;
            }}
            className={cn(backgroundMode === "black" && "rounded-lg bg-black")}
          >
            <img
              src={fileUrl}
              alt=""
              style={{ width: displayWidth }}
              onLoad={() => {
                setNumPages(1);
                setLoading(false);
                onDocumentLoad?.(1);
              }}
              onError={() => setError("image")}
              className={cn(
                "h-auto",
                edgeToEdge || useBlackCanvasChrome
                  ? "rounded-none shadow-none"
                  : "rounded-lg shadow-[var(--shadow-lift)]"
              )}
            />
          </div>
        </div>
      ) : (
        <Document
          file={fileUrl}
          options={DOCUMENT_OPTIONS}
          onLoadSuccess={({ numPages }) => {
            setNumPages(numPages);
            setLoading(false);
            onDocumentLoad?.(numPages);
          }}
          onLoadError={(e) => {
            setError(e.message);
            setLoading(false);
          }}
          loading={spinner}
          error={<div className={centerMsg}>{t("viewer.fileError")}</div>}
        >
          <div
            className={cn(
              edgeToEdge ? "px-0 pt-0" : "px-2 pt-3 sm:px-4",
              singlePageMode
                ? cn("flex h-full items-center justify-center", edgeToEdge ? "pb-0" : "pb-3")
                : cn("flex flex-col items-center", edgeToEdge ? "gap-0 pb-0" : "gap-3 pb-[55vh]")
            )}
          >
            {Array.from({ length: numPages }, (_, i) => {
              if (singlePageMode && i !== clampedVisiblePage - 1) return null;
              const mounted = singlePageMode || (i >= range.start && i <= range.end);
              return (
                <div
                  key={i}
                  ref={(el) => {
                    pageRefs.current[i] = el;
                  }}
                  className={cn(
                    "pdf-page-fit overflow-hidden",
                    edgeToEdge || useBlackCanvasChrome
                      ? "rounded-none shadow-none"
                      : "rounded-lg shadow-[var(--shadow-lift)]",
                    backgroundMode === "black" ? "bg-black" : "bg-card"
                  )}
                  style={{
                    width: singlePageMode ? singlePageWidth : displayWidth,
                    height: singlePageMode ? undefined : reservedHeight,
                  }}
                >
                  {mounted && (
                    <Page
                      pageNumber={i + 1}
                      width={singlePageMode ? singlePageWidth : RENDER_WIDTH}
                      devicePixelRatio={PAGE_DPR}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={null as unknown as undefined}
                      onLoadSuccess={(page) => {
                        if (aspectRef.current == null) {
                          const w = page.originalWidth || page.width;
                          const h = page.originalHeight || page.height;
                          if (w > 0 && h > 0) {
                            aspectRef.current = h / w;
                            setAspect(h / w);
                          }
                        }
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Document>
      )}
    </div>
  );
});

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function clampPage(page: number, numPages: number): number {
  if (!Number.isFinite(page)) return 1;
  if (numPages <= 1) return 1;
  return Math.min(numPages, Math.max(1, Math.round(page)));
}

function pageProgress(page: number, numPages: number): number {
  if (numPages <= 1) return 0;
  return clamp01((clampPage(page, numPages) - 1) / (numPages - 1));
}
