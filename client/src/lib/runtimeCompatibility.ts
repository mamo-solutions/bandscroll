import { api } from "@/api/client";
import { APP_VERSION } from "@/version";

export const SYNC_PROTOCOL = 2;
const UPDATE_RELOAD_TIMEOUT_MS = 8_000;
const updateReloadKey = (buildId: string): string => `bandscroll.runtime-reload:${buildId}`;

/**
 * Verify the exact deployment before the application is allowed to connect.
 * Returns false after scheduling a reload for a newer runtime.
 */
export async function enforceRuntimeCompatibility(): Promise<boolean> {
  const runtime = await api.runtime();
  if (runtime.syncProtocol === SYNC_PROTOCOL && runtime.buildId === APP_VERSION) return true;
  await reloadForRuntimeUpdate(runtime.buildId);
  return false;
}

/** Force an updated service worker to take control before reloading. */
export async function reloadForRuntimeUpdate(targetBuildId = "unknown"): Promise<void> {
  if (sessionStorage.getItem(updateReloadKey(targetBuildId)) === "1") {
    showUpdateFailure();
    return;
  }
  sessionStorage.setItem(updateReloadKey(targetBuildId), "1");

  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update();

  const worker = registration?.waiting ?? registration?.installing;
  if (worker) {
    const controllerChanged = waitForServiceWorkerControl();
    worker.postMessage({ type: "SKIP_WAITING" });
    await controllerChanged;
  }

  window.location.reload();
}

function waitForServiceWorkerControl(): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(cleanup, UPDATE_RELOAD_TIMEOUT_MS);
    const onControllerChange = () => cleanup();
    function cleanup(): void {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve();
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });
  });
}

function showUpdateFailure(): void {
  document.body.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "A required update could not be applied. Please close and reopen BandScroll.";
  message.style.cssText = "font: 16px system-ui; margin: 2rem; color: #33231d;";
  document.body.append(message);
}

/** Re-check while an open PWA is participating in a live session. */
export function installRuntimeCompatibilityMonitor(): void {
  const check = () => {
    if (navigator.onLine === false) return;
    void enforceRuntimeCompatibility().catch(() => {
      // A transient network failure must not interrupt an already compatible session.
    });
  };

  window.setInterval(check, 60_000);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}
