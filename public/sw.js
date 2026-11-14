/**
 * SamTill POS service worker.
 *
 * Caching policy:
 *  - SAME-ORIGIN static assets only. Requests to `/api/*` or any other origin
 *    (Supabase REST/Auth/Realtime, Paystack, print bridge on 127.0.0.1) are
 *    never intercepted beyond passing through and are NEVER cached.
 *  - Non-GET requests are never cached.
 *  - Hashed build assets (/assets/*) are cache-first.
 *  - Navigations are network-first with STRICT separation between `/app/*` POS
 *    routes and `/` marketing routes — offline `/app/*` navigations never fall
 *    back to the `/` marketing shell.
 */

const VERSION = 'samtill-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const APP_FALLBACK_URL = '/app/login';

/** The POS app shell & static assets (never caches `/` marketing HTML into POS fallback). */
const SHELL_URLS = [
  APP_FALLBACK_URL,
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
      await Promise.all(
        SHELL_URLS.map((url) =>
          shell.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
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

/** Same-origin GET only, excluding /api/* endpoints. */
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

function isAppPath(pathname) {
  return pathname === '/app' || pathname.startsWith('/app/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

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

  event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
});

/** Online → always fresh. Offline → strict `/app/login` vs `/` shell separation. */
async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  const appRoute = isAppPath(url.pathname);
  const fallbackKey = appRoute ? APP_FALLBACK_URL : '/';

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const shell = await caches.open(SHELL_CACHE);
      shell.put(fallbackKey, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match(fallbackKey));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline — SamTill POS</title></head>' +
        '<body style="font-family:sans-serif;background:#102A4C;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
        '<div><h1>You are offline</h1><p>SamTill could not load and no cached copy is available. Reconnect and reload.</p></div>' +
        '</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

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
