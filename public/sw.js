/**
 * SamTill POS service worker.
 *
 * Caching policy (see docs/DEPLOYMENT.md §PWA):
 *  - SAME-ORIGIN static assets only. Requests to any other origin
 *    (Supabase REST/Auth/Realtime, Google Fonts, the print bridge on
 *    127.0.0.1) are never intercepted beyond passing them through, and
 *    their responses are NEVER put in a cache — they carry auth tokens,
 *    private customer data or financial records.
 *  - Non-GET requests are never cached (no POST/PUT/DELETE ever touches
 *    this worker's caches), so sales and payment operations cannot be
 *    duplicated by a replaying cache.
 *  - Hashed build assets (/assets/*) are cache-first: their filenames
 *    change on every build, so a cached copy is always the exact version.
 *  - Navigations are network-first with the cached shell as the offline
 *    fallback: an online till always runs the newest code, an offline till
 *    keeps running the last version it saw.
 *
 * The app's data lives in localStorage (local-first); this worker only
 * caches the application shell, never the data.
 */

const VERSION = 'samtill-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/** The app shell: entry page, manifest and brand icons. */
const SHELL_URLS = [
  '/',
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
      // Drop caches from older versions.
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

/** Same-origin GET only — everything else passes straight through. */
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never touch non-GET or cross-origin traffic (Supabase, fonts, bridge).
  if (!isCacheable(request)) return;

  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  const isHashedAsset = url.pathname.startsWith('/assets/');

  if (isNavigation) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isHashedAsset) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Everything else same-origin (icons, manifest, robots…): cache on first
  // use, revalidate in the background.
  event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
});

/** Online → always fresh (never serve the app an old version silently). */
async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const shell = await caches.open(SHELL_CACHE);
      shell.put('/', response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match('/')) || (await caches.match(request));
    if (cached) return cached;
    // Last resort: a minimal offline notice (no cache at all — first visit
    // was offline).
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline — SamTill POS</title></head>' +
        '<body style="font-family:sans-serif;background:#102A4C;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
        '<div><h1>You are offline</h1><p>SamTill could not load and no cached copy is available. Reconnect and reload.</p></div>' +
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
  if (response && response.ok) {
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
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const response = await network;
  return response || new Response('', { status: 504 });
}
