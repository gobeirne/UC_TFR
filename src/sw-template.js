/* Service worker: caches the app shell, MediaPipe WASM and the face model so the
 * app runs offline after the first load. It never sees camera data: video is
 * processed in-page and is never fetched or cached. Generated at build time. */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `tfr-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((u) => new Request(new URL(u, self.registration.scope), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("tfr-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const remoteModel = url.hostname === "storage.googleapis.com" && url.pathname.includes("mediapipe-models");
  if (!sameOrigin && !remoteModel) return;

  if (req.mode === "navigate") {
    // Network first so updates arrive when online; cached shell when offline.
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch { return (await caches.match(new URL("./", self.registration.scope).href)) || (await caches.match(new URL("./index.html", self.registration.scope).href)) || Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && (res.type === "basic" || res.type === "cors")) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
