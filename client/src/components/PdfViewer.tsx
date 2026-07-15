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
import type { ScrollAnchor, SessionBackgroundMode } from "@/types/session";
import {
  anchorToScrollTop,
  getEffectivePageHeights,
  getPageTopOffsets,
  getReservedPageHeights,
  getSinglePageWidth,
  scrollTopToAnchor,
  getVisiblePageRange,
} from "./pdfViewerLayout";
import {
  getDarkPixelBottomFraction,
  getSongEndProgress,
  getTextBottomInPagePx,
  type PdfViewportLike,
} from "./pdfTextBounds";

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
const VISUAL_ANALYSIS_WIDTH = 320;

export type PdfViewerHandle = {
  scrollToProgress: (progress: number) => void;
  scrollToPage: (page: number) => void;
  getProgressForPage: (page: number) => number;
  getCurrentPage: () => number;
  getCurrentProgress: () => number;
  getScrollMetrics: () => PdfViewerScrollMetrics | null;
  getScrollAnchor: () => ScrollAnchor | null;
  getProgressForAnchor: (anchor: ScrollAnchor) => number | null;
  scrollToAnchor: (anchor: ScrollAnchor) => void;
  getSongEndProgress: (
    startPage: number,
    nextMarkerPage: number,
    bottomBufferFraction: number
  ) => Promise<number | null>;
  readonly numPages: number;
};

type PdfTextContentLike = {
  items: Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
  }>;
};

type PdfTextPageLike = {
  getViewport: (params: { scale: number }) => PdfViewportLike & { width: number };
  getTextContent: () => Promise<PdfTextContentLike>;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike & { width: number };
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void> };
};

type PdfTextDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfTextPageLike>;
};

export type PdfViewerScrollMetrics = {
  viewportHeightPx: number;
  maxScrollPx: number;
  scrollableScreens: number;
};

type Props = {
  fileUrl: string;
  documentDescription?: string;
  regionLabel?: string;
  describedById?: string;
  backgroundMode?: SessionBackgroundMode;
  edgeToEdge?: boolean;
  flush?: boolean;
  /** When set, render only this page instead of the full scrollable document. */
  visiblePage?: number;
  /** Called (already DOM-throttled by rAF) when the user scrolls manually. */
  onUserScroll?: (progress: number) => void;
  /** Called when a PDF finishes loading with its page count. */
  onDocumentLoad?: (numPages: number) => void;
  /** Called whenever the viewer's scroll metrics become available or change. */
  onMetricsChange?: (metrics: PdfViewerScrollMetrics | null) => void;
  /** When true, all user-initiated scroll input (wheel, touch, keys) is blocked.
   *  Programmatic scrolling via scrollToProgress still works. */
  blockUserScroll?: boolean;
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  {
    fileUrl,
    documentDescription,
    regionLabel,
    describedById,
    backgroundMode = "light",
    edgeToEdge = false,
    flush = false,
    visiblePage,
    onUserScroll,
    onDocumentLoad,
    onMetricsChange,
    blockUserScroll,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Last metrics pushed to the parent, so we only notify on a real value change
  // (getScrollMetrics returns a fresh object each call, which would otherwise
  // re-trigger the parent's setState on every render — an infinite loop).
  const lastMetricsRef = useRef<PdfViewerScrollMetrics | null>(null);
  const [numPages, setNumPages] = useState(0);
  // CSS display width of each page/image wrapper (responsive).
  const [displayWidth, setDisplayWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(0);
  const [pageAspects, setPageAspects] = useState<number[]>([]);
  const [measuredPageHeights, setMeasuredPageHeights] = useState<(number | null)[]>([]);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const rafPending = useRef(false);
  const readyRef = useRef(false);
  const fileLoadIdRef = useRef(0);
  const pageHeightObserverRef = useRef<ResizeObserver | null>(null);
  const observedPageElementsRef = useRef<(HTMLDivElement | null)[]>([]);
  const pdfDocumentRef = useRef<PdfTextDocumentLike | null>(null);
  const pageTextBottomFractionPromisesRef = useRef(new Map<number, Promise<number | null>>());
  const pageVisualBottomFractionPromisesRef = useRef(new Map<number, Promise<number | null>>());
  const { t } = useI18n();

  const isImage = IMAGE_RE.test(fileUrl);
  const singlePageMode = visiblePage !== undefined;
  const clampedVisiblePage = clampPage(visiblePage ?? 1, numPages);
  const useBlackCanvasChrome = backgroundMode === "black" && singlePageMode;
  const chromeFlush = edgeToEdge || flush;

  // Reset everything whenever the file changes (initial load or swap).
  useEffect(() => {
    fileLoadIdRef.current += 1;
    setLoading(true);
    setError(null);
    setNumPages(0);
    setPageAspects([]);
    setMeasuredPageHeights([]);
    setRange({ start: 0, end: 0 });
    pageRefs.current = [];
    observedPageElementsRef.current = [];
    readyRef.current = false;
    pdfDocumentRef.current = null;
    pageTextBottomFractionPromisesRef.current.clear();
    pageVisualBottomFractionPromisesRef.current.clear();
  }, [fileUrl]);

  // Ready = safe to drive programmatic scrolling. Avoids scrolling before the
  // document has real geometry (which the conductor's loop would otherwise spam).
  useEffect(() => {
    readyRef.current = isImage ? !loading : numPages > 0 && pageAspects.length === numPages;
  }, [isImage, loading, numPages, pageAspects]);

  const predictedPageHeights = getReservedPageHeights(displayWidth, pageAspects);
  const effectivePageHeights = getEffectivePageHeights(predictedPageHeights, measuredPageHeights);
  const pageTopOffsets = getPageTopOffsets(effectivePageHeights, PAGE_TOP, PAGE_GAP);
  const currentPageAspect = pageAspects[clampedVisiblePage - 1] ?? pageAspects[0] ?? null;
  const singlePageWidth = getSinglePageWidth(
    displayWidth,
    containerHeight,
    currentPageAspect,
    chromeFlush
  );

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setMeasuredPageHeights((current) => {
        let changed = false;
        const next = current.slice();
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (!Number.isInteger(index) || index < 0) continue;
          const measuredHeight = Math.max(1, Math.round(entry.contentRect.height));
          if (next[index] !== measuredHeight) {
            next[index] = measuredHeight;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    pageHeightObserverRef.current = observer;

    for (const [index, el] of pageRefs.current.entries()) {
      if (!el) continue;
      el.dataset.pageIndex = String(index);
      observer.observe(el);
      observedPageElementsRef.current[index] = el;
    }

    return () => {
      observer.disconnect();
      pageHeightObserverRef.current = null;
    };
  }, []);

  const setPageRef = useCallback((index: number, el: HTMLDivElement | null) => {
    const observer = pageHeightObserverRef.current;
    const previousEl = observedPageElementsRef.current[index];
    if (observer && previousEl && previousEl !== el) {
      observer.unobserve(previousEl);
    }

    pageRefs.current[index] = el;
    observedPageElementsRef.current[index] = el;

    if (el) {
      el.dataset.pageIndex = String(index);
      observer?.observe(el);
    }
  }, []);

  const maxScroll = () => {
    if (singlePageMode) return 1;
    const el = scrollRef.current;
    if (!el) return 0;
    return Math.max(1, el.scrollHeight - el.clientHeight);
  };

  const hasScrollGeometry = () => {
    const el = scrollRef.current;
    return (
      !singlePageMode &&
      readyRef.current &&
      el !== null &&
      pageTopOffsets.length === numPages &&
      effectivePageHeights.length === numPages &&
      el.scrollHeight > el.clientHeight
    );
  };

  const getScrollMetrics = useCallback((): PdfViewerScrollMetrics | null => {
    const el = scrollRef.current;
    if (!el || !readyRef.current || singlePageMode) return null;
    const viewportHeightPx = Math.max(1, el.clientHeight);
    const maxScrollPx = maxScroll();
    return {
      viewportHeightPx,
      maxScrollPx,
      scrollableScreens: Math.max(1, maxScrollPx / viewportHeightPx),
    };
  }, [singlePageMode]);

  const getProgressForPage = (page: number) => {
    if (singlePageMode) return pageProgress(page, numPages);
    const el = scrollRef.current;
    const pageEl = pageRefs.current[page - 1];
    if (!el) return 0;
    if (pageEl) return clamp01(pageEl.offsetTop / maxScroll());
    const pageTop = pageTopOffsets[page - 1];
    if (pageTop == null) return pageProgress(page, numPages);
    return clamp01(pageTop / maxScroll());
  };

  const getCurrentPage = () => {
    if (singlePageMode) return clampedVisiblePage;
    const el = scrollRef.current;
    if (!el || numPages <= 1 || pageTopOffsets.length === 0) return 1;

    let nearestPage = 1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < numPages; index++) {
      const pageTop = pageRefs.current[index]?.offsetTop ?? pageTopOffsets[index];
      if (pageTop == null) continue;
      const distance = Math.abs(pageTop - el.scrollTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = index + 1;
      }
    }
    return nearestPage;
  };

  const getScrollAnchor = () => {
    if (singlePageMode) return { page: clampedVisiblePage, fraction: 0 };
    const el = scrollRef.current;
    if (!el || !hasScrollGeometry()) return null;
    return scrollTopToAnchor(el.scrollTop, pageTopOffsets, effectivePageHeights);
  };

  const getProgressForAnchor = (anchor: ScrollAnchor): number | null => {
    if (!hasScrollGeometry()) return null;
    const scrollTop = anchorToScrollTop(anchor, pageTopOffsets, effectivePageHeights, maxScroll());
    return scrollTop === null ? null : clamp01(scrollTop / maxScroll());
  };

  const getPageTextBottomFraction = useCallback(
    (pageNumber: number): Promise<number | null> => {
      const existing = pageTextBottomFractionPromisesRef.current.get(pageNumber);
      if (existing) return existing;
      const pdf = pdfDocumentRef.current;
      if (!pdf) return Promise.resolve(null);

      const promise = pdf
        .getPage(pageNumber)
        .then(async (page) => {
          const [textContent, viewport] = await Promise.all([
            page.getTextContent(),
            Promise.resolve(page.getViewport({ scale: 1 })),
          ]);
          const textBottom = getTextBottomInPagePx(textContent.items, viewport, viewport.height);
          return textBottom === null ? null : textBottom / viewport.height;
        })
        .catch(() => null);
      pageTextBottomFractionPromisesRef.current.set(pageNumber, promise);
      return promise;
    },
    []
  );

  const getPageVisualBottomFraction = useCallback(
    (pageNumber: number): Promise<number | null> => {
      const existing = pageVisualBottomFractionPromisesRef.current.get(pageNumber);
      if (existing) return existing;
      const pdf = pdfDocumentRef.current;
      if (!pdf || typeof document === "undefined") return Promise.resolve(null);

      const promise = pdf
        .getPage(pageNumber)
        .then(async (page) => {
          const unscaledViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: VISUAL_ANALYSIS_WIDTH / Math.max(1, unscaledViewport.width),
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return null;
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          return getDarkPixelBottomFraction(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height
          );
        })
        .catch(() => null);
      pageVisualBottomFractionPromisesRef.current.set(pageNumber, promise);
      return promise;
    },
    []
  );

  const getSongEndProgressForRange = useCallback(
    async (startPage: number, nextMarkerPage: number, bottomBufferFraction: number) => {
      const pdf = pdfDocumentRef.current;
      const metrics = getScrollMetrics();
      if (!pdf || !metrics || singlePageMode || nextMarkerPage <= startPage) return null;

      const firstPage = clampPage(startPage, numPages);
      const finalPage = clampPage(nextMarkerPage - 1, numPages);
      let finalTextBottom: { page: number; bottomPx: number } | null = null;

      for (let pageNumber = firstPage; pageNumber <= finalPage; pageNumber += 1) {
        const textBottomFraction = await getPageTextBottomFraction(pageNumber);
        const contentBottomFraction =
          textBottomFraction ?? (await getPageVisualBottomFraction(pageNumber));
        const pageHeight = effectivePageHeights[pageNumber - 1];
        if (contentBottomFraction !== null && pageHeight !== undefined) {
          finalTextBottom = { page: pageNumber, bottomPx: contentBottomFraction * pageHeight };
        }
      }

      if (!finalTextBottom) return null;
      const pageTop = pageRefs.current[finalTextBottom.page - 1]?.offsetTop ?? pageTopOffsets[finalTextBottom.page - 1];
      if (pageTop === undefined) return null;
      return getSongEndProgress({
        pageTopPx: pageTop,
        textBottomInPagePx: finalTextBottom.bottomPx,
        viewportHeightPx: metrics.viewportHeightPx,
        maxScrollPx: metrics.maxScrollPx,
        bottomBufferFraction,
      });
    },
    [
      effectivePageHeights,
      getPageTextBottomFraction,
      getPageVisualBottomFraction,
      getScrollMetrics,
      numPages,
      pageTopOffsets,
      singlePageMode,
    ]
  );

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
        const pageTop = pageEl?.offsetTop ?? pageTopOffsets[page - 1];
        if (pageTop == null) return;
        el.scrollTop = pageTop;
      },
      scrollToAnchor(anchor: ScrollAnchor) {
        const el = scrollRef.current;
        if (!el || !hasScrollGeometry()) return;
        const scrollTop = anchorToScrollTop(
          anchor,
          pageTopOffsets,
          effectivePageHeights,
          maxScroll()
        );
        if (scrollTop !== null) el.scrollTop = scrollTop;
      },
      getProgressForPage,
      getCurrentPage,
      getScrollAnchor,
      getProgressForAnchor,
      getCurrentProgress() {
        if (singlePageMode) return pageProgress(clampedVisiblePage, numPages);
        const el = scrollRef.current;
        if (!el) return 0;
        return clamp01(el.scrollTop / maxScroll());
      },
      getScrollMetrics,
      getSongEndProgress: getSongEndProgressForRange,
      get numPages() {
        return numPages;
      },
    }),
    [clampedVisiblePage, effectivePageHeights, getProgressForAnchor, getProgressForPage, getScrollAnchor, getScrollMetrics, getSongEndProgressForRange, numPages, pageTopOffsets, singlePageMode]
  );

  useEffect(() => {
    const next = getScrollMetrics();
    const prev = lastMetricsRef.current;
    const unchanged =
      prev === next ||
      (prev != null &&
        next != null &&
        prev.viewportHeightPx === next.viewportHeightPx &&
        prev.maxScrollPx === next.maxScrollPx &&
        prev.scrollableScreens === next.scrollableScreens);
    if (unchanged) return;
    lastMetricsRef.current = next;
    onMetricsChange?.(next);
  }, [
    containerHeight,
    effectivePageHeights,
    getScrollMetrics,
    numPages,
    onMetricsChange,
    pageAspects,
    singlePageMode,
  ]);

  // Responsive display width — only drives CSS sizing of already-rasterized
  // pages, so reacting to it is cheap (no PDF.js re-render on resize/rotate).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const inset = chromeFlush ? 0 : 24;
      const w = el.clientWidth - inset;
      setDisplayWidth(Math.max(280, w));
      setContainerHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chromeFlush]);

  // Compute which pages should be mounted based on the current scroll position.
  const updateRange = useCallback(() => {
    if (singlePageMode) {
      const index = Math.max(0, clampedVisiblePage - 1);
      setRange((current) =>
        current.start === index && current.end === index ? current : { start: index, end: index }
      );
      return;
    }
    const el = scrollRef.current;
    if (!el || numPages === 0 || effectivePageHeights.length !== numPages) return;
    const nextRange = getVisiblePageRange(
      el.scrollTop,
      el.clientHeight,
      pageTopOffsets,
      effectivePageHeights,
      OVERSCAN
    );
    setRange((current) =>
      current.start === nextRange.start && current.end === nextRange.end ? current : nextRange
    );
  }, [clampedVisiblePage, effectivePageHeights, numPages, pageTopOffsets, singlePageMode]);

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
      if (document.activeElement !== el) return;
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
    el.addEventListener("keydown", preventKey);
    return () => {
      el.removeEventListener("wheel", prevent);
      el.removeEventListener("touchmove", prevent);
      el.removeEventListener("keydown", preventKey);
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
      role={regionLabel ? "region" : undefined}
      aria-label={regionLabel}
      aria-describedby={describedById}
      className={cn(
        "relative h-full",
        backgroundMode === "black" ? "bg-black" : "bg-muted/40",
        blockUserScroll
          ? "overflow-hidden overscroll-none touch-none"
          : "scrollbar-warm overflow-y-auto"
      )}
      ref={scrollRef}
      tabIndex={blockUserScroll ? 0 : undefined}
      onScroll={handleScroll}
    >
      {error ? (
        <div className={centerMsg}>{t("viewer.fileError")}</div>
      ) : isImage ? (
        <div
          className={cn(
            "flex flex-col items-center",
            chromeFlush ? "px-0 pt-0" : "px-2 pt-3 sm:px-4",
            singlePageMode
              ? cn("h-full justify-center", chromeFlush ? "pb-0" : "pb-3")
              : chromeFlush
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
              setPageRef(0, el);
            }}
            className={cn(backgroundMode === "black" && "rounded-lg bg-black")}
          >
            <img
              src={fileUrl}
              alt={documentDescription ?? ""}
              style={{ width: displayWidth }}
              onLoad={() => {
                setNumPages(1);
                setLoading(false);
                onDocumentLoad?.(1);
              }}
              onError={() => setError("image")}
              className={cn(
                "h-auto",
                chromeFlush || useBlackCanvasChrome
                  ? "rounded-none shadow-none"
                  : "rounded-lg shadow-[var(--shadow-lift)]"
              )}
            />
          </div>
        </div>
      ) : (
        <Document
          file={fileUrl}
          className={cn(singlePageMode && "h-full")}
          options={DOCUMENT_OPTIONS}
          onLoadSuccess={async (pdf) => {
            const loadId = fileLoadIdRef.current;
            try {
              const nextPageAspects = await loadPdfPageAspects(pdf);
              if (loadId !== fileLoadIdRef.current) return;
              setPageAspects(nextPageAspects);
              pdfDocumentRef.current = pdf as unknown as PdfTextDocumentLike;
              setNumPages(pdf.numPages);
              setLoading(false);
              onDocumentLoad?.(pdf.numPages);
            } catch (e) {
              if (loadId !== fileLoadIdRef.current) return;
              setError(e instanceof Error ? e.message : "pdf-metrics");
              setLoading(false);
            }
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
              chromeFlush ? "px-0 pt-0" : "px-2 pt-3 sm:px-4",
              singlePageMode
                ? cn("flex h-full items-center justify-center", chromeFlush ? "pb-0" : "pb-3")
                : cn("flex flex-col items-center", chromeFlush ? "gap-0" : "gap-3")
            )}
            style={
              singlePageMode
                ? undefined
                : { paddingBottom: Math.max(1, containerHeight) }
            }
          >
            {Array.from({ length: numPages }, (_, i) => {
              if (singlePageMode && i !== clampedVisiblePage - 1) return null;
              const mounted = singlePageMode || (i >= range.start && i <= range.end);
              return (
                <div
                  key={i}
                  ref={(el) => {
                    setPageRef(i, el);
                  }}
                  className={cn(
                    "pdf-page-fit",
                    chromeFlush || useBlackCanvasChrome
                      ? "rounded-none shadow-none"
                      : "rounded-lg shadow-[var(--shadow-lift)]",
                    backgroundMode === "black" ? "bg-black" : "bg-card"
                  )}
                  style={{
                    width: singlePageMode ? singlePageWidth : displayWidth,
                    ...(singlePageMode
                      ? {}
                      : mounted
                        ? { minHeight: effectivePageHeights[i] ?? predictedPageHeights[i] }
                        : { height: effectivePageHeights[i] ?? predictedPageHeights[i] }),
                  }}
                >
                  {mounted && (
                    <Page
                      key={`${i + 1}-${backgroundMode}`}
                      pageNumber={i + 1}
                      width={singlePageMode ? singlePageWidth : RENDER_WIDTH}
                      devicePixelRatio={PAGE_DPR}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={
                        backgroundMode === "black" ? (
                          <div className="h-full min-h-24 w-full bg-black" />
                        ) : (null as unknown as undefined)
                      }
                      canvasBackground={backgroundMode === "black" ? "#000000" : undefined}
                      className={cn(backgroundMode === "black" && "[&>canvas]:bg-black")}
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

type PdfPageLike = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
};

type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
};

async function loadPdfPageAspects(pdf: PdfDocumentLike): Promise<number[]> {
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      if (viewport.width <= 0 || viewport.height <= 0) return 1;
      return viewport.height / viewport.width;
    })
  );
}
