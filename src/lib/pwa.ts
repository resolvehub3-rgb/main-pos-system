/**
 * PWA runtime: service-worker registration, update flow, smart install detection.
 *
 * Design rules:
 *  - Updates NEVER apply silently. A new service worker (SW) waits until the
 *    operator explicitly taps "Update" — a checkout in progress is never
 *    destroyed by a background reload.
 *  - Installation detection is honest across 3 states:
 *      • 'installed'   — running standalone OR browser reports installed via
 *                        getInstalledRelatedApps / appinstalled.
 *      • 'installable' — browser fired `beforeinstallprompt` and prompt() is ready.
 *      • 'unsupported' — browser does not expose a native install prompt;
 *                        show accurate per-platform manual steps.
 *  - The service worker itself (public/sw.js) caches only public static assets
 *    and isolates `/app/*` offline shells from `/` marketing pages.
 */

const INSTALLED_FLAG_KEY = 'samtill_pwa_installed_v1';

export type PwaInstallState = 'installed' | 'installable' | 'unsupported';

export type InstallPlatform =
  | 'chrome-windows'
  | 'edge-windows'
  | 'chrome-android'
  | 'safari-ios';

/** True when running as an installed app (standalone window / home screen). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari legacy flag.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Pure resolution of PWA install state for testability and UI consistency.
 * Never claims 'installed' or 'installable' without real browser evidence.
 */
export function resolveInstallState(input: {
  standalone: boolean;
  relatedInstalled: boolean;
  appInstalledRecorded: boolean;
  hasPromptEvent: boolean;
}): PwaInstallState {
  if (input.standalone || input.relatedInstalled || input.appInstalledRecorded) {
    return 'installed';
  }
  if (input.hasPromptEvent) {
    return 'installable';
  }
  return 'unsupported';
}

/** Detect preferred browser/OS guide tab from a User-Agent string. */
export function detectInstallPlatform(userAgent: string): InstallPlatform {
  const ua = userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'safari-ios';
  if (/Android/i.test(ua)) return 'chrome-android';
  if (/Edg\//i.test(ua)) return 'edge-windows';
  return 'chrome-windows';
}

/** Give the installed app window a short, native-feeling title. */
export function applyStandaloneTitle(): void {
  if (typeof document === 'undefined') return;
  if (isStandalone()) document.title = 'SamTill POS';
}

/* -------------------------------------------------------------------------- */
/* Service worker registration                                                */
/* -------------------------------------------------------------------------- */

let swRegistration: ServiceWorkerRegistration | null = null;
let swInitialized = false;

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
 * Register the service worker once (production only).
 *
 * In dev the SW is intentionally not registered: a cached shell would mask
 * fresh module graphs during Vite dev and confuse local testing.
 */
export function registerServiceWorker(): void {
  if (swInitialized) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (import.meta.env?.MODE !== 'production') return;
  swInitialized = true;

  const wireRegistration = (reg: ServiceWorkerRegistration) => {
    swRegistration = reg;

    if (reg.waiting && navigator.serviceWorker.controller) {
      notifyUpdate(reg);
    }

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          notifyUpdate(reg);
        }
      });
    });
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistration('/')
      .then((existing) => existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/' }))
      .then(wireRegistration)
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

/** Activate the waiting service worker and reload onto the new version. */
export function applyUpdate(): void {
  const waiting = swRegistration?.waiting;
  if (!waiting) return;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/* -------------------------------------------------------------------------- */
/* Smart Install Detection & Prompt                                           */
/* -------------------------------------------------------------------------- */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let promptListenersBound = false;
let relatedInstalledCached = false;

const installListeners = new Set<() => void>();

function notifyInstallListeners(): void {
  installListeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.warn('Install listener error:', err);
    }
  });
}

function readRecordedInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(INSTALLED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRecordedInstalled(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage?.setItem(INSTALLED_FLAG_KEY, '1');
    else window.localStorage?.removeItem(INSTALLED_FLAG_KEY);
  } catch {
    // Storage disabled (private mode) — in-memory state still works.
  }
}

/** Subscribe to any change in PWA install availability/status. */
export function onInstallAvailable(cb: () => void): () => void {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}

/** Set up beforeinstallprompt, appinstalled, and getInstalledRelatedApps detection. */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined' || promptListenersBound) return;
  promptListenersBound = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // If Chromium fires beforeinstallprompt, the app is NOT currently installed
    // on this profile — clear any stale recorded flag cleanly.
    writeRecordedInstalled(false);
    relatedInstalledCached = false;
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    relatedInstalledCached = true;
    writeRecordedInstalled(true);
    notifyInstallListeners();
  });

  // Check Chromium's getInstalledRelatedApps() when supported so an already-
  // installed PWA opened in a normal browser tab still switches to "Open SamTill".
  const nav = window.navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
  };
  if (typeof nav.getInstalledRelatedApps === 'function') {
    nav
      .getInstalledRelatedApps()
      .then((apps) => {
        if (Array.isArray(apps) && apps.length > 0) {
          relatedInstalledCached = true;
          writeRecordedInstalled(true);
          notifyInstallListeners();
        }
      })
      .catch(() => {
        // Unsupported origin / browser policy — ignore silently.
      });
  }
}

/** Current honest 3-state PWA install status. */
export function getPwaInstallState(): PwaInstallState {
  return resolveInstallState({
    standalone: isStandalone(),
    relatedInstalled: relatedInstalledCached,
    appInstalledRecorded: readRecordedInstalled(),
    hasPromptEvent: deferredInstallPrompt !== null,
  });
}

/** True when a real browser install prompt is ready to be shown. */
export function canPromptInstall(): boolean {
  return getPwaInstallState() === 'installable';
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
    if (choice.outcome === 'accepted') {
      relatedInstalledCached = true;
      writeRecordedInstalled(true);
    }
    notifyInstallListeners();
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    notifyInstallListeners();
    return 'dismissed';
  }
}
