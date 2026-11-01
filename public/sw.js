// Keeps the app's own files on the device so it opens without a connection.
// Only this app's own path is cached: GitHub requests, and so the token, never pass through here,
// and the deck on the same origin is kept by the app itself.
const CACHE = "shell-v2";
const SCOPE = new URL("./", location).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const html = await (await fetch("./", { cache: "no-cache" })).text();
      // The first visit loads these before the worker exists, so fetch them here.
      const built = html.match(/assets\/[^"']+/g) ?? [];
      await cache.addAll(["./", "./manifest.webmanifest", ...built]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;

  if (request.mode === "navigate") {
    // Network first, so a new version shows up as soon as the device is online.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put("./", response.clone());
          return response;
        } catch {
          return (await cache.match("./")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
