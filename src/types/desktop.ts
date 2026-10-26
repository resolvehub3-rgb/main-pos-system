/**
 * Contract between the Electron preload (`electron/preload.ts`) and the
 * renderer (`src/lib/desktopBridge.ts`).
 *
 * Type-only module: both sides import it for typing, no runtime code is shared
 * through it. The preload exposes exactly the functions declared here on
 * `window.samtillDesktop` — nothing else. On the web the global is absent and
 * the bridge falls back to today's browser behaviour.
 */
import type {CustomerDisplayState} from './index';

export interface DesktopDisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  bounds: {x: number; y: number; width: number; height: number};
}

export type UpdateStatus =
  | {state: 'not-configured'}
  | {state: 'up-to-date'; version: string}
  | {
      state: 'available';
      /** Version offered by the release manifest. */
      version: string;
      /** Version currently running. */
      currentVersion: string;
      notes: string;
      /** Where the installer can be downloaded (publisher-hosted, https). */
      url: string;
    }
  | {state: 'error'; message: string};

export interface DesktopApi {
  /** Application version from package.json. */
  getVersion(): Promise<string>;
  /** Sanitised list of attached displays. */
  listDisplays(): Promise<DesktopDisplayInfo[]>;
  /**
   * Open (or focus) the native customer display window on a suitable secondary
   * display. `opened: false` means no usable second monitor exists — the
   * caller should fall back to the in-page preview modal.
   */
  openCustomerDisplay(): Promise<{opened: boolean; reason?: string}>;
  /** Close the native customer display window (user-initiated). */
  closeCustomerDisplay(): Promise<void>;
  /** Last cart state pushed by the cashier — used to restore after reloads. */
  getCustomerDisplayState(): Promise<CustomerDisplayState | null>;
  /** Cashier → customer display: push the current cart state. */
  setCustomerDisplayState(
    state: CustomerDisplayState,
  ): Promise<{ok: boolean; error?: string}>;
  /** Subscribe to state pushes (customer display window). Returns unsubscribe. */
  onCustomerDisplayState(cb: (state: CustomerDisplayState) => void): () => void;
  /** Subscribe to display hot-plug changes (cashier window). */
  onDisplaysChanged(cb: (displays: DesktopDisplayInfo[]) => void): () => void;
  /** Fired when the native customer display window has been opened. */
  onCustomerDisplayOpened(cb: () => void): () => void;
  /** Subscribe to update-check results (cashier window). */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  /** Run an update check now. Safe at any time — never installs anything. */
  checkForUpdates(): Promise<UpdateStatus>;
  /** Open an http(s) URL in the operating system's browser. */
  openExternal(url: string): Promise<{ok: boolean; error?: string}>;
  /*
   * Frameless window controls (desktop only). The main process gates every one
   * of these to the cashier window's own main frame, so the customer display
   * and any popup are structurally unable to drive the till's chrome.
   */
  /** Minimize the cashier window. */
  windowMinimize(): Promise<void>;
  /** Toggle maximize/restore; resolves with the resulting maximized state. */
  windowToggleMaximize(): Promise<{maximized: boolean}>;
  /** Current maximized state (drives the max/restore icon). */
  windowIsMaximized(): Promise<boolean>;
  /** Close the cashier window (quits the app). */
  windowClose(): Promise<void>;
  /** Subscribe to maximize-state changes (e.g. window snapped via keyboard). */
  onWindowMaximizedChanged(cb: (maximized: boolean) => void): () => void;
}
