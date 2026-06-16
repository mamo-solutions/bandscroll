// Centralized client error reporting. Logs to the console (when one exists) and
// best-effort ships the error to the server so crashes without a visible
// console — notably mobile Safari, e.g. on orientation change — are still
// captured in the server log.

let windowStart = 0;
let sentInWindow = 0;
const MAX_PER_MINUTE = 10;

function describeViewport(): string {
  const o =
    (screen as unknown as { orientation?: { type?: string } }).orientation?.type ??
    (window.orientation !== undefined ? `angle:${window.orientation}` : "");
  return `${window.innerWidth}x${window.innerHeight} ${o}`.trim();
}

export function reportError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const err =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");

  // Always surface locally first.
  // eslint-disable-next-line no-console
  console.error(`[BandScroll:${context}]`, err, extra ?? "");

  // Rate-limit so a render/crash loop can't flood the server.
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_PER_MINUTE) return;
  sentInWindow++;

  try {
    const payload = JSON.stringify({
      context,
      message: err.message,
      stack: err.stack,
      url: location.href,
      viewport: describeViewport(),
      userAgent: navigator.userAgent,
      ...extra,
    });
    // sendBeacon survives page unload/crash; fall back to keepalive fetch.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/client-log",
        new Blob([payload], { type: "application/json" })
      );
    } else {
      void fetch("/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // The logger must never throw.
  }
}

/** Catch errors React's boundaries can't see: async, rAF, and event handlers. */
export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (e) => {
    // Benign Safari/Chrome resize noise — not a real crash.
    if (typeof e.message === "string" && e.message.includes("ResizeObserver loop")) {
      return;
    }
    reportError("window.error", e.error ?? e.message, {
      source: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    reportError("unhandledrejection", e.reason);
  });
}
