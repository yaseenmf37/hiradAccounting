const STATIC_CACHE = "hirad-static-v3";
const OFFLINE_CACHE = "hirad-offline-v4";
const OFFLINE_PAGE = "/offline.html";
const OFFLINE_WORKSPACE = "/offline-workspace";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.add(OFFLINE_PAGE);
    try {
      await cacheOfflineShell();
    } catch (error) {
      console.error("Offline dashboard shell could not be cached:", error);
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("hirad-static-") && key !== STATIC_CACHE) ||
                (key.startsWith("hirad-offline-") && key !== OFFLINE_CACHE)
            )
            .map((key) => caches.delete(key))
        )
      ),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CACHE_OFFLINE_SHELL") {
    event.waitUntil(cacheOfflineShell());
  }
});

async function cacheOfflineShell() {
  const response = await fetch(OFFLINE_WORKSPACE, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Offline workspace returned ${response.status}`);
  }

  const offlineCache = await caches.open(OFFLINE_CACHE);
  await offlineCache.put(OFFLINE_WORKSPACE, response.clone());
  const markup = await response.text();
  const assets = [
    ...markup.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g),
  ].map((match) => match[1]);
  const uniqueAssets = [...new Set(assets)];
  await Promise.all(
    uniqueAssets.map(async (asset) => {
      const assetResponse = await fetch(asset, { cache: "no-store" });
      if (!assetResponse.ok) {
        throw new Error(`Offline shell asset failed: ${asset}`);
      }
      const assetCache = asset.startsWith("/_next/static/")
        ? await caches.open(STATIC_CACHE)
        : offlineCache;
      await assetCache.put(asset, assetResponse);
    })
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (url.pathname !== "/" && url.pathname !== OFFLINE_WORKSPACE) return;
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(async () => {
        const offlineCache = await caches.open(OFFLINE_CACHE);
        const offlineWorkspace = await offlineCache.match(OFFLINE_WORKSPACE);
        if (offlineWorkspace && url.pathname === "/") {
          return Response.redirect(
            new URL(OFFLINE_WORKSPACE, self.location.origin),
            302
          );
        }
        if (offlineWorkspace) return offlineWorkspace;
        const cachedOfflinePage = await offlineCache.match(OFFLINE_PAGE);
        return (
          cachedOfflinePage ??
          new Response("Offline", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      })
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;

        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
        return response;
      })
    );
  }
});
