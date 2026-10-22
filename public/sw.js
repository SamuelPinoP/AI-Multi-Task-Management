// AI Multi service worker (SMART-10): offline reading for the installable app,
// and browser push notifications (SMART-08).
//
// Plain JavaScript served as /sw.js, so Turbopack (Vercel, CI) and webpack
// (local worktrees) builds ship the same file. Registered by
// src/components/pwa.tsx in production builds only.
//
// - Pages: network first; a copy of each page you open is kept for offline use.
// - Read-only API data the pages load (tasks, notes, projects...): same.
// - Build assets under /_next/static: cache first (their names change on deploy).
// - Everything else (sign-in, saving, uploads, downloads, files opened from
//   /api or /uploads) goes straight to the network.
//
// - Push: shows what src/lib/notifications.ts sends ({ title, body, url, tag })
//   and opens its page when clicked, in an open AI Multi tab if there is one.
//
// Saved pages and data live in caches named "ai-multi-user-*". The app asks
// this worker to delete them when you log out or open a signed-out page
// (clearOfflineData in pwa.tsx). Bump VERSION when the build-asset rules
// change, to drop the old asset cache.

const VERSION = "v1";
const STATIC_CACHE = `ai-multi-static-${VERSION}`;
const PAGE_CACHE = "ai-multi-user-pages";
const API_CACHE = "ai-multi-user-api";
const MAX_PAGES = 60;
const MAX_API_RESPONSES = 150;
const MAX_STATIC_FILES = 400;
const USER_CACHE_PREFIX = "ai-multi-user-";

// Goes up on every "clear-user-data" message. A save that started before a
// clear is dropped, so a slow response can't put a signed-out user's data back.
let generation = 0;

// GET endpoints whose answers are worth reading offline. Attachments are left
// out on purpose: they can be large, and they are fetched from storage.
const API_PREFIXES = [
  "/api/events",
  "/api/goals",
  "/api/notes",
  "/api/project-invitations",
  "/api/projects",
  "/api/recent-shortcuts",
  "/api/tasks",
  "/api/trash",
  "/api/tree-pages",
  "/api/workspace-nav",
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("ai-multi-static-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Files opened in a tab (attachments, uploads) aren't pages.
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;
    event.respondWith(networkFirst(event, PAGE_CACHE, MAX_PAGES, offlinePage));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event));
  } else if (isReadableApi(url)) {
    event.respondWith(networkFirst(event, API_CACHE, MAX_API_RESPONSES, offlineApiResponse));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not ours, or garbled: show nothing rather than a broken notification.
    return;
  }
  if (typeof data.title !== "string") return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only pages of this app; anything else falls back to Home.
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  const href = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(href);
        return;
      }
      await self.clients.openWindow(href);
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-user-data") {
    generation += 1;
    event.waitUntil(clearUserCaches());
    return;
  }
  // The page sends the URLs it loaded before this worker took control (its own
  // address, build assets and API data), so the first page you open is readable
  // offline too.
  if (event.data?.type !== "cache-urls" || !Array.isArray(event.data.urls)) return;
  const started = generation;
  event.waitUntil(
    Promise.all(
      event.data.urls.slice(0, 100).map(async (href) => {
        try {
          const url = new URL(href, self.location.origin);
          if (url.origin !== self.location.origin) return;
          if (isStaticAsset(url)) {
            if (!(await caches.match(url.href, { cacheName: STATIC_CACHE }))) {
              await saveResponse(STATIC_CACHE, url.href, await fetch(url.href), MAX_STATIC_FILES, started);
            }
          } else if (url.href === event.data.page) {
            await saveResponse(PAGE_CACHE, url.href, await fetch(url.href), MAX_PAGES, started);
          } else if (isReadableApi(url)) {
            await saveResponse(API_CACHE, url.href, await fetch(url.href), MAX_API_RESPONSES, started);
          }
        } catch {
          // Offline or gone: nothing to keep.
        }
      }),
    ),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isReadableApi(url) {
  if (url.pathname.includes("/attachments/")) return false;
  return API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

function cacheable(response) {
  return response.ok && response.type === "basic" && !response.redirected;
}

async function clearUserCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(USER_CACHE_PREFIX)).map((name) => caches.delete(name)));
}

async function saveResponse(cacheName, request, response, maxEntries, started) {
  if (!cacheable(response)) return;
  // Pages are saved only as HTML: a file opened from elsewhere isn't a page.
  if (cacheName === PAGE_CACHE && !(response.headers.get("content-type") ?? "").startsWith("text/html")) return;
  const userData = cacheName !== STATIC_CACHE;
  if (userData && started !== generation) return;
  const cache = await caches.open(cacheName);
  // A clear between the check above and open() has bumped the generation by now.
  if (userData && started !== generation) return;
  await cache.put(request, response);
  // put() moves an updated entry to the end, so the oldest come first.
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

async function networkFirst(event, cacheName, maxEntries, fallback) {
  const { request } = event;
  const started = generation;
  try {
    const response = (await event.preloadResponse) || (await fetch(request));
    if (cacheable(response)) event.waitUntil(saveResponse(cacheName, request, response.clone(), maxEntries, started));
    return response;
  } catch {
    // caches.match() with a cacheName doesn't create the cache when it's missing.
    const saved =
      (await caches.match(request, { cacheName, ignoreVary: true })) ||
      (request.mode === "navigate" ? await caches.match(request, { cacheName, ignoreSearch: true, ignoreVary: true }) : undefined);
    return saved || fallback();
  }
}

async function cacheFirst(event) {
  const saved = await caches.match(event.request, { cacheName: STATIC_CACHE });
  if (saved) return saved;
  const response = await fetch(event.request);
  if (cacheable(response)) event.waitUntil(saveResponse(STATIC_CACHE, event.request, response.clone(), MAX_STATIC_FILES, generation));
  return response;
}

function offlineApiResponse() {
  return new Response(JSON.stringify({ error: "You're offline. This loads again when you reconnect." }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

// Shown for pages you haven't opened since installing. Self-contained, because
// the app's own styles may not be saved yet.
function offlinePage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline - AI Multi</title>
<style>
  :root { color-scheme: light dark; --canvas: #f6f8f7; --surface: #ffffff; --ink: #101a19; --muted: #5d6b67; --line: #dee5e2; --accent: #0a6f68; --accent-ink: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --canvas: #0e1413; --surface: #172120; --ink: #e3ebe9; --muted: #8fa09b; --line: #25302e; --accent: #3fc2b4; --accent-ink: #06201d; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--canvas); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 420px; padding: 28px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
  h1 { margin: 0 0 8px; font-size: 1.375rem; }
  p { margin: 0 0 20px; color: var(--muted); line-height: 1.5; }
  button { font: inherit; font-weight: 600; padding: 8px 16px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-ink); cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>You're offline</h1>
  <p>This page hasn't been saved on this device yet. Pages you've opened before are still available. Reconnect to load this one.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
