// River Guide service worker: the app and the last river levels this phone saw
// still open with no signal. Kept deliberately small:
// - pages and the section list/pages: network first; on failure, or when the
//   network is too slow to be useful, the last copy, marked x-rg-offline: 1
// - hashed build assets, fonts, icons: cache first (their URLs change when they do)
// - everything else (graphs, weather, reports, chat): network only
// Change VERSION to drop every cache on the next visit.

const VERSION = 'v1';
const PAGES = `rg-pages-${VERSION}`;
const API = `rg-api-${VERSION}`;
const STATIC = `rg-static-${VERSION}`;
/** How long to wait for the network before showing the saved copy (one bar of signal). */
const NETWORK_WAIT_MS = 4000;
/** Hashed assets kept; older ones are dropped as new builds arrive. */
const STATIC_MAX = 60;

// Save the app shell, the build files it loads, and the section list on install, so a single
// visit is enough to open the app later with no signal (the first page load happens before
// this worker is in control, so nothing from it was saved).
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const shell = await fetch('/', { cache: 'no-cache' });
        if (!shell.ok) return;
        const html = await shell.clone().text();
        await (await caches.open(PAGES)).put('/', shell);
        const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/(?:assets|fonts)\/[^"]+)"/g)].map((m) => m[1]))];
        const statics = await caches.open(STATIC);
        await Promise.all(assets.map((a) => statics.add(a).catch(() => undefined)));
        const api = await caches.open(API);
        await Promise.all(
          ['/api/sections', '/api/config'].map((u) =>
            fetch(u)
              .then((r) => (r.ok ? api.put(u, r) : undefined))
              .catch(() => undefined),
          ),
        );
      } catch {
        // Offline support is a bonus: never block the worker from installing.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, API, STATIC]);
      for (const key of await caches.keys()) if (key.startsWith('rg-') && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const offline = (res) => {
  const headers = new Headers(res.headers);
  headers.set('x-rg-offline', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

/** Network first, falling back to the saved copy on failure or after NETWORK_WAIT_MS. */
async function networkFirst(event, cacheName, key) {
  const cache = await caches.open(cacheName);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok) await cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => undefined)); // keep refreshing the saved copy even after a fallback
  const saved = await cache.match(key);
  if (!saved) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve('slow'), NETWORK_WAIT_MS));
  try {
    const first = await Promise.race([network, slow]);
    return first === 'slow' ? offline(saved) : first;
  } catch {
    return offline(saved);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - STATIC_MAX))) await cache.delete(old);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Every page is the same app shell, so one saved copy serves any URL.
  if (req.mode === 'navigate') return event.respondWith(networkFirst(event, PAGES, '/'));
  if (url.pathname === '/api/sections' || url.pathname === '/api/config' || /^\/api\/sections\/[a-z0-9-]+$/i.test(url.pathname)) {
    return event.respondWith(networkFirst(event, API, url.pathname));
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    return event.respondWith(cacheFirst(req));
  }
});
