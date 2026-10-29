/**
 * PWA runtime: service-worker registration, update flow, install prompt.
 *
 * Design rules:
 *  - Updates NEVER apply silently. A new service worker (SW) waits until the
 *    operator explicitly taps "Update" — a checkout in progress is never
 *    destroyed by a background reload.
 *  - The install button only ever offers the browser's real installation
 *    mechanism (`beforeinstallprompt`). When the browser does not expose one
 *    (e.g. iOS Safari, Firefox), the UI shows accurate manual instructions
 *    instead of a fake button.
 *  - The service worker itself (public/sw.js) caches only public static
 *    assets; it never caches Supabase responses, auth, or private data.
 */

/** True when running as an installed app (standalone window / home screen). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari legacy flag.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/* -------------------------------------------------------------------------- */
/* Service worker registration                                                */
/* -------------------------------------------------------------------------- */

let swRegistration: ServiceWorkerRegistration | null = null;

/** Callbacks notified when a new SW is installed and waiting to activate. */
const updateListeners = new Set<(reg: ServiceWorkerRegistration) => void>();

/** Subscribe to "an update is ready" events. Returns an unsubscribe fn. */
export function onUpdateReady(cb: (reg: ServiceWorkerRegistration) => void): () => void {
  updateListeners.add(cb);
  return () => updateListeners.delete(cb);
}

function notifyUpdate(reg: ServiceWorkerRegistration): void {
  updateListeners.forEach((cb) => {
    try {
      cb(reg);
    } catch (err) {
      console.warn('Update listener error:', err);
    }
  });
}

/**
 * Register the service worker (production only).
 *
 * In dev the SW is intentionally not registered: a cached shell would mask
 * fresh module graphs during HMR and confuse local testing.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // Gate on Vite's build MODE (set by `--mode`, default "production" for
  // `vite build` and "development" for `vite dev`) rather than
  // import.meta.env.PROD. PROD is derived from NODE_ENV, which a local
  // .env file can pin to "development" and silently strip this whole
  // function from the production bundle. MODE is unaffected by that.
  if (import.meta.env.MODE !== 'production') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        swRegistration = reg;

        // An update may already be waiting (previous visit installed it but
        // the page was never reloaded).
        if (reg.waiting && navigator.serviceWorker.controller) {
          notifyUpdate(reg);
        }

        // A fresh update finished installing while this page is open.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // "installed" with an existing controller = new version waiting.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              notifyUpdate(reg);
            }
          });
        });
      })
      .catch((err) => {
        // Registration failure must never break the POS — the app runs fine
        // without a SW (it is online-only then).
        console.warn('Service worker registration failed:', err);
      });

    // Reload exactly once when the user-approved update takes control.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

/**
 * Activate the waiting service worker and reload onto the new version.
 *
 * Call ONLY from an explicit user action (the Update button). The
 * `controllerchange` handler above performs the single reload.
 */
export function applyUpdate(): void {
  const waiting = swRegistration?.waiting;
  if (!waiting) return;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/* -------------------------------------------------------------------------- */
/* Install prompt                                                              */
/* -------------------------------------------------------------------------- */

/** The browser's deferred install event (Chromium family). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

/** Callbacks notified when the browser makes installation available. */
const installListeners = new Set<() => void>();

/** Subscribe to "install became available". Returns an unsubscribe fn. */
export function onInstallAvailable(cb: () => void): () => void {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}

/** Set up the beforeinstallprompt capture. Call once at app start. */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the event so the UI can trigger the real install later. Chromium
    // fires this only when the app is genuinely installable (manifest OK,
    // SW controlling, engagement heuristics met).
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    installListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.warn('Install listener error:', err);
      }
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.warn('Install listener error:', err);
      }
    });
  });
}

/** True when a real browser install prompt is ready to be shown. */
export function canPromptInstall(): boolean {
  return deferredInstallPrompt !== null && !isStandalone();
}

/**
 * Show the browser's install prompt.
 * Returns 'accepted' | 'dismissed' | 'unavailable'.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredInstallPrompt;
  if (!event) return 'unavailable';
  deferredInstallPrompt = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}
