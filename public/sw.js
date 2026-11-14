/**
 * SamTill POS service worker (scoped to /app/).
 *
 * Caching policy:
 *  - Scope isolation: registered under /app/ so the public marketing website
 *    (/, /features, /pricing, /about, /contact, /download) is never cached or
 *    intercepted by the POS service worker, avoiding marketing vs POS caching
 *    conflicts.
 *  - SAME-ORIGIN static assets only. Requests to any other origin
 *    (Supabase REST/Auth/Realtime, Google Fonts, the print bridge on
 *    127.0.0.1) are never intercepted beyond passing them through, and
 *    their responses are NEVER put in a cache — they carry auth tokens,
 *    private customer data or financial records.
 *  - Non-GET requests and authenticated / API requests (/api/*, Authorization
 *    headers, no-store/private responses) are never cached.
 *  - Hashed build assets (/assets/*) are cache-first: their filenames
 *    change on every build, so a cached copy is always the exact version.
 *  - POS navigations (/app/*) are network-first with the cached /app/login
 *    app shell as the offline fallback — NEVER caching or serving '/'.
 *
 * The app's offline business data and unsynchronized sales queue live in
 * localStorage; cache cleanups during SW updates never touch localStorage.
 */

const VERSION = 'samtill-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const POS_SHELL_KEY = '/app/login';

/** The POS app shell: POS entry routes, manifest and brand icons. */
const SHELL_URLS = [
  '/app/login',
  '/app/',
  '/manifest.json',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // addAll fails the whole install if ANY url fails; add each one so a
      // single missing icon cannot break installation.
      await Promise.all(
        SHELL_URLS.map((url) =>
          shell.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
    })(),
  );
  // No skipWaiting here: a new version waits for the user to press Update
  // (see src/lib/pwa.ts) so an active checkout is never torn down.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop CacheStorage entries from older versions only; localStorage /
      // IndexedDB business records and pending sync queues are untouched.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.startsWith(`${VERSION}-`))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isPosNavigationPath(pathname) {
  return pathname === '/app' || pathname.startsWith('/app/');
}

function isSensitiveResponse(response) {
  const cc = (response.headers.get('cache-control') || '').toLowerCase();
  return cc.includes('no-store') || cc.includes('private');
}

/** Same-origin GET only, excluding API and authenticated requests. */
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  if (request.headers.has('authorization')) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never touch non-GET, authenticated, /api/*, or cross-origin traffic.
  if (!isCacheable(request)) return;

  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  const isHashedAsset = url.pathname.startsWith('/assets/');

  if (isNavigation) {
    // Only cache and serve fallback for POS (/app/*) navigations — never cache
    // or fall back to the marketing homepage.
    if (!isPosNavigationPath(url.pathname)) return;
    event.respondWith(networkFirstPosNavigation(request));
    return;
  }

  if (isHashedAsset) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Other same-origin static assets (icons, manifest): cache on first use,
  // revalidate in the background.
  event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
});

/** Online → always fresh; offline → cached POS shell (/app/login). */
async function networkFirstPosNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && !isSensitiveResponse(response)) {
      const shell = await caches.open(SHELL_CACHE);
      shell.put(POS_SHELL_KEY, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request)) ||
      (await caches.match(POS_SHELL_KEY)) ||
      (await caches.match('/app/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline — SamTill POS</title></head>' +
        '<body style="font-family:sans-serif;background:#102A4C;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
        '<div><h1>You are offline</h1><p>SamTill POS could not load and no cached copy is available. Reconnect and reload.</p></div>' +
        '</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/** Hashed build assets never change under the same URL. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && !isSensitiveResponse(response)) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/** Serve the cached copy instantly, refresh it in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && !isSensitiveResponse(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const response = await network;
  return response || new Response('', { status: 504 });
}
