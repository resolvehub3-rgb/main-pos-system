/**
 * Desktop (Electron) bridge.
 *
 * The renderer never touches Electron APIs directly — the sandboxed preload
 * exposes a small, typed API on `window.samtillDesktop`, and this module wraps
 * it so components can call desktop features without caring where they run.
 *
 * On the web every function degrades to today's browser behaviour:
 * `isDesktop()` returns false and the open/push helpers no-op, so the existing
 * PWA keeps working exactly as before.
 */
import type {CustomerDisplayState} from '../types';
import type {DesktopApi, DesktopDisplayInfo, UpdateStatus} from '../types/desktop';

declare global {
  interface Window {
    /** Installed by the Electron preload. Undefined in every browser. */
    samtillDesktop?: DesktopApi;
  }
}

function api(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.samtillDesktop ?? null;
}

/** True when running inside the SamTill desktop application. */
export function isDesktop(): boolean {
  return api() !== null;
}

/** App version, or null on the web. */
export function getDesktopVersion(): Promise<string | null> {
  const d = api();
  return d ? d.getVersion().catch(() => null) : Promise.resolve(null);
}

/** Displays attached to this machine (desktop only). */
export function listDisplays(): Promise<DesktopDisplayInfo[]> {
  const d = api();
  return d ? d.listDisplays().catch(() => []) : Promise.resolve([]);
}

/**
 * Ask the main process to open/focus the native customer display window.
 * Returns null on the web; `{opened: false}` when there is no second monitor —
 * callers should then fall back to the in-page preview modal.
 */
export function openNativeCustomerDisplay(): Promise<{opened: boolean; reason?: string} | null> {
  const d = api();
  if (!d) return Promise.resolve(null);
  return d.openCustomerDisplay().catch(() => ({opened: false, reason: 'error'}));
}

export function closeNativeCustomerDisplay(): void {
  void api()?.closeCustomerDisplay().catch(() => undefined);
}

/** Last cart state the cashier pushed (null before the first push). */
export function getCustomerDisplayState(): Promise<CustomerDisplayState | null> {
  return api()?.getCustomerDisplayState() ?? Promise.resolve(null);
}

/** Fire-and-forget: push the current cart to the customer display. */
export function pushCustomerDisplayState(state: CustomerDisplayState): void {
  void api()
    ?.setCustomerDisplayState(state)
    .catch(() => undefined);
}

export function onCustomerDisplayState(cb: (state: CustomerDisplayState) => void): () => void {
  return api()?.onCustomerDisplayState(cb) ?? (() => undefined);
}

export function onCustomerDisplayOpened(cb: () => void): () => void {
  return api()?.onCustomerDisplayOpened(cb) ?? (() => undefined);
}

export function onDisplaysChanged(cb: (displays: DesktopDisplayInfo[]) => void): () => void {
  return api()?.onDisplaysChanged(cb) ?? (() => undefined);
}

export function onUpdateStatus(cb: (status: UpdateStatus) => void): () => void {
  return api()?.onUpdateStatus(cb) ?? (() => undefined);
}

export function checkForUpdates(): Promise<UpdateStatus | null> {
  const d = api();
  return d ? d.checkForUpdates().catch((err): UpdateStatus => ({state: 'error', message: String(err)})) : Promise.resolve(null);
}

/** Open an approved http(s) link in the OS browser (desktop only). */
export function openExternalUrl(url: string): void {
  void api()?.openExternal(url).catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* Frameless window controls (desktop only; no-ops on the web)                */
/* -------------------------------------------------------------------------- */

/** Minimize the cashier window. No-op in the browser. */
export function minimizeWindow(): void {
  void api()?.windowMinimize().catch(() => undefined);
}

/** Toggle maximize/restore. No-op in the browser. */
export function toggleMaximizeWindow(): void {
  void api()?.windowToggleMaximize().catch(() => undefined);
}

/** Current maximized state, or null on the web / if unavailable. */
export function isMaximizedWindow(): Promise<boolean | null> {
  const d = api();
  return d ? d.windowIsMaximized().catch(() => null) : Promise.resolve(null);
}

/** Close the cashier window (quits the desktop app). No-op in the browser. */
export function closeWindow(): void {
  void api()?.windowClose().catch(() => undefined);
}

/** Subscribe to maximize-state changes (desktop only). Returns unsubscribe. */
export function onWindowMaximizedChanged(cb: (maximized: boolean) => void): () => void {
  return api()?.onWindowMaximizedChanged(cb) ?? (() => undefined);
}
