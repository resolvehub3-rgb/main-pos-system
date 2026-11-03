/**
 * Dual-monitor support: detect screens, open and place the customer display.
 *
 * Everything here is best-effort by design — browsers deliberately limit what
 * a web app may do with windows and screens, and this module feature-detects
 * each capability instead of assuming it exists:
 *
 *  - Screen enumeration … Window Management API (`window.getScreenDetails`),
 *    which requires a one-time permission grant from a user gesture. Without
 *    it we fall back to `screen.isExtended` (Chromium-only boolean) and,
 *    failing that, honestly report "unknown".
 *  - Window placement … `window.open` `left/top/width/height` features plus a
 *    verified `moveTo/resizeTo`. Browsers may ignore or clamp the coordinates
 *    (popup blockers, single-monitor layouts, OS restrictions), so every
 *    placement is *verified* and reported as `positioned: false` rather than
 *    silently claimed as a success.
 *  - Popups … the first open on an origin needs a user gesture; afterwards the
 *    browser's stored grant usually lets SamTill re-open it at start-up. When
 *    it still refuses, the caller falls back to the in-page preview modal and
 *    shows the one-click activation notice.
 *
 * Nothing here ever hides OS interfaces or uses unsupported hacks: if the
 * browser says no, the UI says so and the sale continues on the cashier till.
 */

/** Rectangle of a screen in virtual-desktop coordinates. */
export interface ScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MonitorReport {
  /** `true`/`false` when the browser reports `screen.isExtended`, else `null`. */
  multipleMonitors: boolean | null;
  /** Exact monitor count — only ever set from the Window Management API. */
  monitorCount: number | null;
  source: 'window-management' | 'is-extended' | 'unknown';
  /** Where the customer display should go, when a secondary screen is known. */
  target?: ScreenBounds;
}

export type MonitorDetection =
  | {ok: true; report: MonitorReport}
  | {ok: false; reason: 'unsupported' | 'denied' | 'error'};

/** Does this browser expose the Window Management API? */
export function supportsWindowManagement(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as Window & {getScreenDetails?: unknown}).getScreenDetails === 'function';
}

/** Does this browser report `screen.isExtended` (multiple monitors)? */
export function supportsIsExtended(): boolean {
  if (typeof screen === 'undefined') return false;
  return typeof (screen as Screen & {isExtended?: unknown}).isExtended === 'boolean';
}

/**
 * Best-effort monitor info without asking for any permission.
 * `multipleMonitors: null` means "this browser does not report it".
 */
export function detectMultiMonitorSync(): MonitorReport {
  if (!supportsIsExtended()) {
    return {multipleMonitors: null, monitorCount: null, source: 'unknown'};
  }
  const extended = Boolean((screen as Screen & {isExtended: boolean}).isExtended);
  return {
    multipleMonitors: extended,
    monitorCount: null,
    source: 'is-extended',
  };
}

/** Minimal shape of a ScreenDetailed we care about. */
export interface ScreenLike {
  availLeft?: number;
  availTop?: number;
  availWidth?: number;
  availHeight?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  isPrimary?: boolean;
}

/**
 * Choose the screen the customer display belongs to: the first non-primary
 * screen (monitor 2), falling back to any screen that is not the one the app
 * window sits on. `undefined` for a single-monitor machine.
 */
export function pickCustomerScreen<T extends ScreenLike>(
  screens: T[],
  currentIndex = 0,
): T | undefined {
  if (!screens || screens.length < 2) return undefined;
  const nonPrimary = screens.find((s) => s.isPrimary === false);
  if (nonPrimary) return nonPrimary;
  return screens.find((_, i) => i !== currentIndex);
}

/** Bounds of a ScreenLike (falls back to the primary-screen fields). */
export function screenBounds(screen: ScreenLike): ScreenBounds {
  const left = screen.left ?? screen.availLeft ?? 0;
  const top = screen.top ?? screen.availTop ?? 0;
  const width = screen.availWidth ?? screen.width ?? 0;
  const height = screen.availHeight ?? screen.height ?? 0;
  return {left, top, width, height};
}

/**
 * Ask the browser (with its one-time permission prompt, so this must run from
 * a user gesture — the settings panel's "Detect monitors" button) for the
 * full screen list and pick the customer-display target.
 */
export async function enumerateMonitors(): Promise<MonitorDetection> {
  if (!supportsWindowManagement()) {
    return {ok: false, reason: 'unsupported'};
  }
  try {
    const details = await (window as unknown as Window & {
      getScreenDetails: () => Promise<{
        screens: ScreenLike[];
        currentScreen?: ScreenLike;
      }>;
    }).getScreenDetails();

    const screens = details.screens ?? [];
    const currentIndex = details.currentScreen
      ? Math.max(0, screens.findIndex((s) => s === details.currentScreen))
      : 0;
    const target = pickCustomerScreen(screens, currentIndex);

    return {
      ok: true,
      report: {
        multipleMonitors: screens.length > 1,
        monitorCount: screens.length,
        source: 'window-management',
        ...(target ? {target: screenBounds(target)} : {}),
      },
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'AbortError') {
      return {ok: false, reason: 'denied'};
    }
    return {ok: false, reason: 'error'};
  }
}

/** Build the customer-display popup URL for a till session. */
export function buildCustomerDisplayUrl(sessionId?: string | null, origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const query = sessionId ? `?view=customer-display&sid=${encodeURIComponent(sessionId)}` : '?view=customer-display';
  return `${base}/${query}`;
}

export interface OpenDisplayOptions {
  url: string;
  /** Screen to place the window on (secondary monitor when known). */
  target?: ScreenBounds | null;
  width?: number;
  height?: number;
}

export interface OpenDisplayResult {
  win: Window;
  /** True only when the window really ended up inside `target` bounds. */
  positioned: boolean;
}

/** Popup features string for the customer display window. */
export function buildWindowFeatures(target?: ScreenBounds | null, width = 1024, height = 700): string {
  const parts = ['popup=yes', `width=${width}`, `height=${height}`];
  if (target) {
    // Centre the window on the target screen; browsers that honour
    // left/top place it there, ones that do not still open the window.
    const left = target.left + Math.max(0, Math.round((target.width - width) / 2));
    const top = target.top + Math.max(0, Math.round((target.height - height) / 2));
    parts.push(`left=${left}`, `top=${top}`);
  }
  return parts.join(',');
}

/** Is `win` (approximately) inside `bounds` right now? */
export function isWindowWithin(win: Window, bounds: ScreenBounds): boolean {
  try {
    const x = win.screenX;
    const y = win.screenY;
    const w = win.outerWidth;
    // 8px tolerance: browsers report the frame origin slightly differently
    // and may clamp by a hair. Anything further away is "not placed".
    const insideX = x >= bounds.left - 8 && x + Math.min(w, bounds.width) <= bounds.left + bounds.width + 8;
    const insideY = y >= bounds.top - 8 && y <= bounds.top + bounds.height + 8;
    return insideX && insideY;
  } catch {
    return false;
  }
}

/**
 * Open (or reuse) the customer display window.
 *
 * Returns `null` when the browser blocked the popup — the caller then falls
 * back to the in-page preview and shows the activation notice. Placement is
 * attempted and verified; `positioned: false` means "window is open, but the
 * browser would not let us move it — the operator drags it to monitor 2".
 */
export function openCustomerDisplayWindow(options: OpenDisplayOptions): OpenDisplayResult | null {
  if (typeof window === 'undefined') return null;

  const {url, target, width = 1024, height = 700} = options;
  let win: Window | null = null;
  try {
    win = window.open(url, 'samtill-customer-display', buildWindowFeatures(target, width, height));
  } catch {
    return null;
  }
  if (!win) return null;

  let positioned = target ? isWindowWithin(win, target) : false;

  // The feature string may have been ignored — try an explicit move/resize.
  if (target && !positioned) {
    try {
      win.resizeTo(width, height);
      win.moveTo(
        target.left + Math.max(0, Math.round((target.width - width) / 2)),
        target.top + Math.max(0, Math.round((target.height - height) / 2)),
      );
      positioned = isWindowWithin(win, target);
    } catch {
      positioned = false;
    }
  }

  return {win, positioned};
}

/** Is this window handle still usable? */
export function isWindowAlive(win: Window | null | undefined): boolean {
  if (!win) return false;
  try {
    return !win.closed;
  } catch {
    return false;
  }
}

/**
 * Try to put the customer display window itself into full-screen mode.
 *
 * Full-screen needs a user gesture in *that* window, so this usually reports
 * `denied` when called from the opener — the display window therefore also
 * offers its own one-click full-screen control. Never throws.
 */
export async function requestFullscreenIn(win: Window | null | undefined): Promise<
  'entered' | 'denied' | 'unsupported' | 'failed' | 'gone'
> {
  if (!isWindowAlive(win)) return 'gone';
  try {
    const doc = win!.document;
    const el = doc.documentElement as HTMLElement & {requestFullscreen?: () => Promise<void>};
    if (typeof doc.fullscreenEnabled === 'boolean' && !doc.fullscreenEnabled) return 'unsupported';
    if (!el.requestFullscreen) return 'unsupported';
    if (doc.fullscreenElement) return 'entered';
    await el.requestFullscreen();
    return doc.fullscreenElement ? 'entered' : 'failed';
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    return 'failed';
  }
}
