/**
 * Full-screen (kiosk) support for the installed SamTill app.
 *
 * The PWA runs in its standalone window (manifest `display: standalone`) —
 * no tabs, address bar or toolbar — and this module layers the browser's
 * standard Fullscreen API on top so the cashier interface can occupy the
 * entire monitor.
 *
 * Browser rules this code respects (there is no way around them):
 *  - `requestFullscreen()` needs a *user gesture*. It can never be entered
 *    silently at start-up, so the app attempts it, reports the denial and
 *    offers a one-click activation notice instead (see KioskNotice).
 *  - Esc / F11 / the browser's own exit controls always work — we never
 *    intercept them, and nothing here hides OS security interfaces.
 *  - `document.fullscreenEnabled` is the feature switch; where it is false
 *    (some embedded browsers, permissions policy) the UI reports
 *    "unsupported" and the app keeps running normally.
 *
 * When the Window Management API has granted screen details, a target screen
 * can be passed so the request lands on the chosen monitor (Chromium
 * ignores the option otherwise — never fatal).
 */
import {useEffect, useState} from 'react';

export type FullscreenResult =
  | 'entered'
  | 'already-fullscreen'
  | 'unsupported'
  | 'denied'
  | 'failed';

/** True when this document may use the Fullscreen API at all. */
export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  // `fullscreenEnabled` is the spec switch; older WebKit only exposes the
  // prefixed request method, so accept that as a fallback.
  if (typeof document.fullscreenEnabled === 'boolean') return document.fullscreenEnabled;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

/** True right now when the app window fills the screen. */
export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement);
}

/**
 * Ask the browser to fill the screen with the app window.
 *
 * `targetScreen` (a ScreenDetailed from the Window Management API) is passed
 * through when provided so the request can name the primary monitor; browsers
 * that do not know the option ignore it.
 */
export async function requestAppFullscreen(targetScreen?: unknown): Promise<FullscreenResult> {
  if (typeof document === 'undefined') return 'unsupported';
  if (isFullscreenActive()) return 'already-fullscreen';
  if (!isFullscreenSupported()) return 'unsupported';

  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  if (!request) return 'unsupported';

  const options = targetScreen ? {screen: targetScreen} : undefined;

  // Some embedded browsers hand back a promise that never settles (neither
  // resolves nor rejects). Racing it keeps the UI honest: a hung request is
  // reported as a failure so the operator gets the one-click notice instead
  // of a button that appears to do nothing. If it settles later and the
  // browser does go full-screen, the `fullscreenchange` listener simply
  // picks that up — nothing is lost by reporting early.
  const settleWithin = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
    new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          throw err;
        },
      );
    });

  try {
    const requestPromise = options
      ? request.call(el, options as FullscreenOptions)
      : request();
    const settled = await settleWithin(requestPromise, 4000);
    // `null` = the request hung and never settled. A rejection propagates to
    // the catch below, which classifies it properly (denied vs failed).
    if (settled === null) return 'failed';
    return 'entered';
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    // Some engines reject the options dictionary outright — retry plain.
    if (options) {
      try {
        await request();
        return 'entered';
      } catch (retryErr) {
        const retryName = retryErr instanceof Error ? retryErr.name : '';
        if (retryName === 'NotAllowedError' || retryName === 'SecurityError') return 'denied';
        return 'failed';
      }
    }
    return 'failed';
  }
}

/** Leave full-screen mode (Esc does the same; provided for buttons/shortcuts). */
export async function exitAppFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || !document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    // The browser may already have exited (Esc) — nothing to do.
  }
}

/** Subscribe to full-screen enter/exit. Returns an unsubscribe function. */
export function subscribeFullscreenChange(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb as EventListener);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb as EventListener);
  };
}

/** React hook: whether the app is currently in full-screen mode. */
export function useFullscreenActive(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(isFullscreenActive());
    return subscribeFullscreenChange(() => setActive(isFullscreenActive()));
  }, []);

  return active;
}
