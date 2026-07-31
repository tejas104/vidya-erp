// Vidya PWA service worker.
//
// STATIC ASSETS ONLY. This is a spec requirement (Assignment #10 Part 3), not
// a performance tradeoff to be optimised differently: the server is the
// single source of truth for every record in the register, so there is no
// offline data and no background sync here. Every request under /api/ is
// left completely alone below — no cache read, no cache write, every time.
const CACHE_NAME = "vidya-static-v1";
const STATIC_EXT = /\.(?:js|css|png|svg|jpg|jpeg|webp|woff2?|ico)$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept writes

  const url = new URL(request.url);

  // Hard boundary — do not touch. Every API response must always come from
  // the server, never a locally cached copy (no offline data, no staleness).
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first, but ONLY for static assets: hashed Next.js build chunks and
  // public/ files (icons, fonts). HTML navigations and every other response
  // fall through untouched — pages are session/role-gated and must always
  // be fetched fresh from the server.
  const isStatic = url.pathname.startsWith("/_next/static/") || STATIC_EXT.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
