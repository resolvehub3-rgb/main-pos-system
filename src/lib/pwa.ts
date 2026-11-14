/**
 * PWA runtime: service-worker registration, update flow, smart install detection.
 *
 * Design rules:
 *  - Updates NEVER apply silently. A new service worker (SW) waits until the
 *    operator explicitly taps "Update" — a checkout in progress is never
 *    destroyed by a background reload.
 *  - The service worker is scoped strictly to `/app/` (`public/sw.js`) so the
 *    marketing website and POS application never share HTML shell caches.
 *  - Any legacy root-scoped (`/`) registration is cleaned up automatically to
 *    avoid duplicate service worker registrations.
 *  - Installation detection combines `display-mode: standalone`,
 *    `navigator.standalone`, `beforeinstallprompt`, `appinstalled`, and
 *    `navigator.getInstalledRelatedApps()` where available.
 */

import {
  resolvePwaInstallState,
  type PwaInstallState,
} from './pwaInstall.ts';

const INSTALLED_HINT_KEY = 'samtill_pwa_installed';

/** True when running as an installed app (standalone window / home screen). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayStandalone =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches);
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(displayStandalone || iosStandalone);
}

/**
 * Give the installed app window a short, native-feeling title.
 */
export function applyStandaloneTitle(): void {
  if (typeof document === 'undefined') return;
  if (isStandalone()) document.title = 'SamTill POS';
}

/* -------------------------------------------------------------------------- */
/* Service worker registration                                                */
/* -------------------------------------------------------------------------- */

let swRegistration: ServiceWorkerRegistration | null = null;
let swRegistrationStarted = false;

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
 * Register the POS service worker under `/app/` scope (production only).
 *
 * Cleans up any legacy root-scoped (`/`) registration first so duplicate
 * service workers never fight over navigation requests, and guards against
 * duplicate `registerServiceWorker()` invocations.
 */
export function registerServiceWorker(): void {
  if (swRegistrationStarted) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (import.meta.env.MODE !== 'production') return;
  swRegistrationStarted = true;

  window.addEventListener('load', async () => {
    try {
      // Remove any legacy root-scoped registration to prevent duplicates and
      // prevent marketing routes from being intercepted by an old v1 worker.
      if (typeof navigator.serviceWorker.getRegistrations === 'function') {
        const existing = await navigator.serviceWorker.getRegistrations();
        const expectedScope = new URL('/app/', window.location.origin).href;
        await Promise.all(
          existing
            .filter((reg) => reg.scope !== expectedScope)
            .map((reg) => reg.unregister().catch(() => false)),
        );
      }

      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/app/' });
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

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });
}

/**
 * Activate the waiting service worker and reload onto the new version.
 */
export function applyUpdate(): void {
  const waiting = swRegistration?.waiting;
  if (!waiting) return;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/* -------------------------------------------------------------------------- */
/* Smart install detection & prompt                                           */
/* -------------------------------------------------------------------------- */

/** The browser's deferred install event (Chromium family). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installPromptInitialized = false;
let installedConfirmed = false;
let lastPromptOutcome: 'idle' | 'accepted' | 'dismissed' = 'idle';

/** Callbacks notified when install state changes. */
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

function readInstalledHint(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(INSTALLED_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeInstalledHint(installed: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (installed) localStorage.setItem(INSTALLED_HINT_KEY, '1');
    else localStorage.removeItem(INSTALLED_HINT_KEY);
  } catch {
    // Ignore storage restriction errors.
  }
}

/** Subscribe to installation availability / state updates. */
export function onInstallAvailable(cb: () => void): () => void {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}

/**
 * Set up smart PWA install detection (`beforeinstallprompt`, `appinstalled`,
 * display-mode media query changes, and `getInstalledRelatedApps()`).
 * Safe to call multiple times — listeners attach at most once.
 */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined' || installPromptInitialized) return;
  installPromptInitialized = true;

  installedConfirmed = isStandalone() || readInstalledHint();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    // Chromium only fires `beforeinstallprompt` when the app is NOT installed,
    // so clear any previous installed mark.
    installedConfirmed = false;
    writeInstalledHint(false);
    notifyInstallListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installedConfirmed = true;
    lastPromptOutcome = 'accepted';
    writeInstalledHint(true);
    notifyInstallListeners();
  });

  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayModeChange = () => {
      if (isStandalone()) {
        installedConfirmed = true;
        writeInstalledHint(true);
      }
      notifyInstallListeners();
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onDisplayModeChange);
    }
  }

  // Query Chromium's Installed Related Apps API when available (non-blocking).
  const nav = window.navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
  };
  if (typeof nav.getInstalledRelatedApps === 'function') {
    nav
      .getInstalledRelatedApps()
      .then((apps) => {
        if (Array.isArray(apps) && apps.length > 0 && !deferredInstallPrompt) {
          installedConfirmed = true;
          writeInstalledHint(true);
          notifyInstallListeners();
        }
      })
      .catch(() => undefined);
  }
}

export interface PwaInstallSnapshot {
  state: PwaInstallState;
  isStandalone: boolean;
  canPrompt: boolean;
  lastOutcome: 'idle' | 'accepted' | 'dismissed';
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  const standalone = isStandalone();
  const hasDeferredPrompt = deferredInstallPrompt !== null && !standalone;
  const state = resolvePwaInstallState({
    isStandalone: standalone,
    isInstalledConfirmed: installedConfirmed,
    hasDeferredPrompt,
  });
  return {
    state,
    isStandalone: standalone,
    canPrompt: hasDeferredPrompt,
    lastOutcome: lastPromptOutcome,
  };
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
    if (choice.outcome === 'accepted') {
      installedConfirmed = true;
      lastPromptOutcome = 'accepted';
      writeInstalledHint(true);
      notifyInstallListeners();
      return 'accepted';
    }
    lastPromptOutcome = 'dismissed';
    notifyInstallListeners();
    return 'dismissed';
  } catch {
    lastPromptOutcome = 'dismissed';
    notifyInstallListeners();
    return 'dismissed';
  }
}
