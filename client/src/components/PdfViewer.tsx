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
import { useI18n } from "@/i18n/I18nProvider";

// Errors-only verbosity: silences harmless "TT: undefined function" font
// warnings from PDF.js. Module-level constant so react-pdf doesn't reload.
const DOCUMENT_OPTIONS = { verbosity: pdfjs.VerbosityLevel.ERRORS };

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

export type PdfViewerHandle = {
  /** Scroll the container to a normalized progress (0..1). */
  scrollToProgress: (progress: number) => void;
  /** Read the current normalized scroll progress (0..1). */
  getCurrentProgress: () => number;
};

type Props = {
  fileUrl: string;
  /** Called (already DOM-throttled by rAF) when the user scrolls manually. */
  onUserScroll?: (progress: number) => void;
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { fileUrl, onUserScroll },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(800);
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

  useImperativeHandle(
    ref,
    () => ({
      scrollToProgress(progress: number) {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = clamp01(progress) * maxScroll();
      },
      getCurrentProgress() {
        const el = scrollRef.current;
        if (!el) return 0;
        return clamp01(el.scrollTop / maxScroll());
      },
    }),
    []
  );

  // Responsive page width based on the container.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.min(900, el.clientWidth - 24);
      setPageWidth(Math.max(280, w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      className="scrollbar-warm relative h-full overflow-y-auto bg-muted/40"
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
          <img
            src={fileUrl}
            alt=""
            style={{ width: pageWidth }}
            onLoad={() => setLoading(false)}
            onError={() => setError("image")}
            className="h-auto rounded-lg shadow-[var(--shadow-lift)]"
          />
        </div>
      ) : (
        <Document
          file={fileUrl}
          options={DOCUMENT_OPTIONS}
          onLoadSuccess={({ numPages }) => {
            setNumPages(numPages);
            setLoading(false);
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
              <Page
                key={i}
                pageNumber={i + 1}
                width={pageWidth}
                className="overflow-hidden rounded-lg shadow-[var(--shadow-lift)]"
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
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
