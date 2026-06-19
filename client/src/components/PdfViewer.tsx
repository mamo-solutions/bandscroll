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
  /** Called (already DOM-throttled by rAF) when the user scrolls manually. */
  onUserScroll?: (progress: number) => void;
  /** Called when a PDF finishes loading with its page count. */
  onDocumentLoad?: (numPages: number) => void;
  /** When true, all user-initiated scroll input (wheel, touch, keys) is blocked.
   *  Programmatic scrolling via scrollToProgress still works. */
  blockUserScroll?: boolean;
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { fileUrl, onUserScroll, onDocumentLoad, blockUserScroll },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [numPages, setNumPages] = useState(0);
  // CSS display width of each page/image wrapper (responsive).
  const [displayWidth, setDisplayWidth] = useState(800);
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

  const maxScroll = () => {
    const el = scrollRef.current;
    if (!el) return 0;
    return Math.max(1, el.scrollHeight - el.clientHeight);
  };

  const getProgressForPage = (page: number) => {
    const el = scrollRef.current;
    const pageEl = pageRefs.current[page - 1];
    if (!el || !pageEl) return 0;
    return clamp01(pageEl.offsetTop / maxScroll());
  };

  const getCurrentPage = () => {
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
        el.scrollTop = clamp01(progress) * maxScroll();
      },
      scrollToPage(page: number) {
        const el = scrollRef.current;
        const pageEl = pageRefs.current[page - 1];
        if (!el || !pageEl) return;
        el.scrollTop = pageEl.offsetTop;
      },
      getProgressForPage,
      getCurrentPage,
      getCurrentProgress() {
        const el = scrollRef.current;
        if (!el) return 0;
        return clamp01(el.scrollTop / maxScroll());
      },
      get numPages() {
        return numPages;
      },
    }),
    [getProgressForPage, numPages]
  );

  // Responsive display width — only drives CSS sizing of already-rasterized
  // pages, so reacting to it is cheap (no PDF.js re-render on resize/rotate).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.min(RENDER_WIDTH, el.clientWidth - 24);
      setDisplayWidth(Math.max(280, w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute which pages should be mounted based on the current scroll position.
  const updateRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el || aspect == null || numPages === 0) return;
    const row = Math.max(1, Math.round(displayWidth * aspect)) + PAGE_GAP;
    const top = el.scrollTop - PAGE_TOP;
    const start = Math.max(0, Math.floor(top / row) - OVERSCAN);
    const end = Math.min(numPages - 1, Math.floor((top + el.clientHeight) / row) + OVERSCAN);
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, [aspect, numPages, displayWidth]);

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
      if (onUserScroll && el) onUserScroll(clamp01(el.scrollTop / maxScroll()));
    });
  }, [onUserScroll, updateRange]);

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
        "relative h-full bg-muted/40",
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
        <div className="flex flex-col items-center px-2 pb-[55vh] pt-3 sm:px-4">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
              {spinner}
            </div>
          )}
          <div ref={(el) => { pageRefs.current[0] = el; }}>
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
              className="h-auto rounded-lg shadow-[var(--shadow-lift)]"
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
          <div className="flex flex-col items-center gap-3 px-2 pb-[55vh] pt-3 sm:px-4">
            {Array.from({ length: numPages }, (_, i) => {
              const mounted = i >= range.start && i <= range.end;
              return (
                <div
                  key={i}
                  ref={(el) => { pageRefs.current[i] = el; }}
                  className="pdf-page-fit overflow-hidden rounded-lg bg-card shadow-[var(--shadow-lift)]"
                  style={{ width: displayWidth, height: reservedHeight }}
                >
                  {mounted && (
                    <Page
                      pageNumber={i + 1}
                      width={RENDER_WIDTH}
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
