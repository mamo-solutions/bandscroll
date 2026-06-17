import { useEffect, useRef } from "react";

/** Keep the device screen awake while `active` is true.
 *  Uses the Screen Wake Lock API when available; silently no-ops otherwise. */
export function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    const request = async () => {
      try {
        lockRef.current = await navigator.wakeLock.request("screen");
      } catch {
        // Wake lock may be denied (e.g. battery saver, background tab). Ignore.
      }
    };

    const release = () => {
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };

    if (active) {
      request();
    } else {
      release();
    }

    // Re-acquire the lock when the tab becomes visible again (the browser
    // automatically releases it while the page is hidden).
    const onVisibilityChange = () => {
      if (document.hidden) {
        release();
        return;
      }
      if (active) request();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    };
  }, [active]);
}
