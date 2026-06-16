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
// orientation change never re-rasterizes the canvases — the previous behavior
// (width tied to the container) re-rendered all 40+ pages at once on rotate,
// blocking the main thread for seconds and crashing the tab.
const RENDER_WIDTH = 1000;
// Cap the device pixel ratio so large documents don't exhaust memory on
// high-DPI phones (a 40-page PDF at DPR 3 is ~1 GB of canvas).
const PAGE_DPR =
  typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;

export type PdfViewerHandle = {
  /** Scroll the container to a normalized progress (0..1). */
  scrollToProgress: (progress: number) => void;
  /** Scroll so the top of the requested page (1-indexed) aligns with the viewport top. */
  scrollToPage: (page: number) => void;
  /** Normalized progress for the top of the requested page (1-indexed). */
  getProgressForPage: (page: number) => number;
  /** Read the current normalized scroll progress (0..1). */
  getCurrentProgress: () => number;
  /** Total pages in the loaded PDF (0 for images or while loading). */
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
  // CSS display width of each page/image wrapper (responsive). The PDF bitmap
  // itself is always rendered at RENDER_WIDTH and scaled to this with CSS.
  const [displayWidth, setDisplayWidth] = useState(800);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const rafPending = useRef(false);
  const { t } = useI18n();

  // Reset loading/error state whenever the file changes (initial load or swap).
  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [fileUrl]);

  const maxScroll = () => {
    const el = scrollRef.current;
    if (!el) return 0;
    return Math.max(1, el.scrollHeight - el.clientHeight);
  };

  const getPageElement = (page: number) => pageRefs.current[page - 1];

  const getProgressForPage = (page: number) => {
    const el = scrollRef.current;
    const pageEl = getPageElement(page);
    if (!el || !pageEl) return 0;
    return clamp01(pageEl.offsetTop / maxScroll());
  };

  useImperativeHandle(
    ref,
    () => ({
      scrollToProgress(progress: number) {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = clamp01(progress) * maxScroll();
      },
      scrollToPage(page: number) {
        const el = scrollRef.current;
        const pageEl = getPageElement(page);
        if (!el || !pageEl) return;
        el.scrollTop = clamp01(pageEl.offsetTop / maxScroll()) * maxScroll();
      },
      getProgressForPage,
      getCurrentProgress() {
        const el = scrollRef.current;
        if (!el) return 0;
        return clamp01(el.scrollTop / maxScroll());
      },
      get numPages() {
        return numPages;
      },
    }),
    []
  );

  // Responsive display width from the container. This only drives CSS sizing of
  // the (already-rasterized) pages, so reacting to it is cheap — no PDF.js
  // re-render happens on resize/rotate.
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

  // Block user-initiated scrolling on read-only viewers to prevent lag or
  // de-sync from competing with the conductor's auto-scroll.
  useEffect(() => {
    if (!blockUserScroll) return;
    const el = scrollRef.current;
    if (!el) return;

    const prevent = (e: Event) => e.preventDefault();
    const preventKey = (e: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
          "Spacebar",
        ].includes(e.key)
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
    if (!onUserScroll || rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      const el = scrollRef.current;
      if (el) onUserScroll(clamp01(el.scrollTop / maxScroll()));
    });
  }, [onUserScroll]);

  const centerMsg = "flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground";
  const isImage = IMAGE_RE.test(fileUrl);

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
              onLoad={() => setLoading(false)}
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
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                ref={(el) => { pageRefs.current[i] = el; }}
                className="pdf-page-fit overflow-hidden rounded-lg shadow-[var(--shadow-lift)]"
                style={{ width: displayWidth }}
              >
                <Page
                  pageNumber={i + 1}
                  width={RENDER_WIDTH}
                  devicePixelRatio={PAGE_DPR}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </div>
            ))}
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
