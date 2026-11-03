/**
 * Best-effort maximization for the installed SamTill PWA window.
 *
 * SamTill deliberately does NOT use the browser Fullscreen API or kiosk mode:
 * the required experience is a normal maximized window that keeps the native
 * Windows title bar, minimize/maximize/restore/close buttons and the taskbar.
 *
 * Web code cannot force a top-level window to maximize — `resizeTo`/`moveTo`
 * are blocked for windows the page did not open, and there is no manifest field
 * for window state. In practice the browser/OS restores the last window state
 * for an installed PWA, so once the operator maximizes SamTill once it stays
 * maximized on every subsequent launch. This helper is the only supported nudge
 * and is intentionally silent on failure.
 *
 * For an administrator who wants guaranteed maximization on first launch, add
 * `--start-maximized` to the installed-app shortcut target (Edge/Chrome create
 * that shortcut on install) or apply the Edge enterprise policy
 * `ConfigureDefaultStartupMode` / kiosk-less maximized startup. See
 * docs/DUAL-SCREEN.md and docs/DEPLOYMENT.md.
 */
export function tryMaximizeWindow(): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.resizeTo === 'function' && typeof screen !== 'undefined') {
      window.resizeTo(screen.availWidth, screen.availHeight);
    }
    if (typeof window.moveTo === 'function') {
      window.moveTo(0, 0);
    }
  } catch {
    // The browser/OS owns the window; nothing to do.
  }
}