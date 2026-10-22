"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The installable app (SMART-10): registers public/sw.js, offers the browser's
 * install prompt, and says when you're reading saved copies offline.
 */

/** Caches that hold the signed-in user's pages and data (see public/sw.js). */
const USER_CACHE_PREFIX = "ai-multi-user-";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function setInstallPrompt(event: InstallPromptEvent | null) {
  installPrompt = event;
  installListeners.forEach((listener) => listener());
}

/**
 * Deletes the pages and data saved for offline reading. Call it before signing
 * out. The service worker also drops any save still in flight; deleting here
 * too covers a page it doesn't control. Gives up after 1.5 seconds, so a
 * stuck storage layer never blocks logging out.
 */
export async function clearOfflineData() {
  if (typeof caches === "undefined") return;
  const clear = async () => {
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: "clear-user-data" });
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(USER_CACHE_PREFIX)).map((name) => caches.delete(name)));
    } catch {
      // Storage blocked (private mode, permissions): nothing was saved either.
    }
  };
  await Promise.race([clear(), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

/**
 * Mounted once in the root layout. Registers the service worker in production
 * builds, and removes saved copies whenever no one is signed in, so the next
 * person on this device can't read them offline.
 */
export function ServiceWorkerRegistration({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) void clearOfflineData();
  }, [signedIn]);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Keep the browser's mini-infobar quiet; the account menu offers "Install app".
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const registration = await navigator.serviceWorker.ready;
        if (cancelled || !signedIn) return;
        // This page loaded before the worker could see it: hand it the URLs to save.
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(location.origin));
        registration.active?.postMessage({ type: "cache-urls", page: location.href, urls: [location.href, ...urls] });
      } catch {
        // Unsupported or blocked: the app still works online.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return null;
}

/** The browser's install prompt, once it has offered one; null otherwise. */
export function useInstallPrompt() {
  return useSyncExternalStore(
    (listener) => {
      installListeners.add(listener);
      return () => installListeners.delete(listener);
    },
    () => installPrompt,
    () => null,
  );
}

export async function promptInstall(event: InstallPromptEvent) {
  setInstallPrompt(null);
  await event.prompt();
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** A notice above the page while the browser is offline. The live region stays mounted so the change is announced. */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div role="status" className="shrink-0">
      {online ? null : (
        <p className="flex items-center gap-2 border-b border-line bg-warning-soft px-4 py-2 text-sm text-warning sm:px-6">
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>You&apos;re offline. You&apos;re reading the last saved copy; changes won&apos;t save until you reconnect.</span>
        </p>
      )}
    </div>
  );
}
