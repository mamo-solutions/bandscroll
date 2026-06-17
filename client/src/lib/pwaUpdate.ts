// The service worker is registered with registerType "autoUpdate", so a new
// build is applied (skipWaiting + clientsClaim) and the page reloads as soon as
// the browser *finds* an updated worker. The gap is discovery: a PWA kept open
// in standalone mode (typical on phones) only checks on a fresh navigation.
//
// This nudges the browser to re-check `sw.js` (served no-cache, so it's always
// fresh) periodically and whenever the app regains focus, so clients pick up
// fixes without the user manually reloading.
export function installPwaUpdater(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.ready
    .then((registration) => {
      const check = () => {
        // Only check when online to avoid noisy failures offline.
        if (navigator.onLine !== false) registration.update().catch(() => {});
      };

      // Re-check every 5 minutes while open.
      setInterval(check, 5 * 60 * 1000);
      // ...and whenever the user returns to the app.
      window.addEventListener("focus", check);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    })
    .catch(() => {
      // No active service worker yet (first visit) — nothing to poll.
    });
}
