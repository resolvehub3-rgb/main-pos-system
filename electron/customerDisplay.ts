/**
 * Native customer display window (second monitor).
 *
 * Ownership rules:
 *  - The MAIN process owns this window: it is created at startup (when the
 *    operator left it enabled and a suitable monitor exists) or on an explicit
 *    request from the cashier renderer. Renderer reloads never create it, and
 *    at most one instance ever exists.
 *  - The cashier window is the single source of truth for the cart. It pushes
 *    a narrow, validated `CustomerDisplayState` over IPC; the main process
 *    caches the last state (so the window can open or reload at any moment and
 *    still show the current sale) and forwards it. No second source of truth.
 *  - A display that disappears closes the window without touching the sale; a
 *    suitable display appearing re-opens it when the operator had it enabled.
 */
import {BrowserWindow, screen, type Display} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {CustomerDisplayState} from '../src/types/index';
import type {DesktopDisplayInfo} from '../src/types/desktop';

export interface CustomerDisplayDeps {
  /** URL of the customer-display view (same origin as the cashier). */
  getCustomerDisplayUrl: () => string;
  /** Preload script shared by every window. */
  preloadPath: string;
  /** Icon for the window (dev builds; packaged Windows uses the exe icon). */
  iconPath?: string;
  /** Main→cashier notifications (display changes, window opened). */
  notifyCashier: (channel: string, payload?: unknown) => void;
  /** Persisted app-data directory. */
  userDataPath: string;
}

/**
 * A display is only "suitable" when it is not the primary one and is at least
 * 800×600 — Windows occasionally reports odd virtual/phantom displays, and the
 * cashier must never be covered by a customer window on a degenerate screen.
 */
const MIN_SECONDARY_WIDTH = 800;
const MIN_SECONDARY_HEIGHT = 600;

const STATE_FILE = 'desktop-state.json';

interface PersistedState {
  customerDisplayDesired?: boolean;
}

export class CustomerDisplayController {
  private win: BrowserWindow | null = null;
  private displayId: number | null = null;
  /** Operator wants the native window (persisted across launches). */
  private desired = false;
  /** True while the controller itself closes the window (display removed). */
  private systemClose = false;
  /** Last state pushed by the cashier — replayed to late/reloading windows. */
  private lastState: CustomerDisplayState | null = null;

  private readonly stateFile: string;

  constructor(private readonly deps: CustomerDisplayDeps) {
    this.stateFile = path.join(deps.userDataPath, STATE_FILE);
    this.desired = this.readPersisted().customerDisplayDesired === true;
  }

  /* ---------------------------------------------------------------------- */
  /* Display selection                                                       */
  /* ---------------------------------------------------------------------- */

  /** The non-primary, sensibly-sized display, if any. */
  pickSecondaryDisplay(): Display | null {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return (
      displays.find(
        (d) =>
          d.id !== primary.id &&
          d.bounds.width >= MIN_SECONDARY_WIDTH &&
          d.bounds.height >= MIN_SECONDARY_HEIGHT,
      ) ?? null
    );
  }

  /** Sanitised display list for the renderer (ids, labels, bounds only). */
  getDisplays(): DesktopDisplayInfo[] {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: typeof d.label === 'string' ? d.label : '',
      primary: d.id === primary.id,
      bounds: {
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      },
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Window lifecycle                                                        */
  /* ---------------------------------------------------------------------- */

  isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  /** Whether the operator wants the native window (auto-open at startup). */
  isDesired(): boolean {
    return this.desired;
  }

  /** The customer window's renderer, when it exists (QA/smoke helper). */
  getWebContents(): Electron.WebContents | null {
    return this.isOpen() ? this.win!.webContents : null;
  }

  /**
   * Open (or focus) the native customer display window.
   *
   * Returns `{opened: false, reason: 'no-secondary-display'}` when there is no
   * usable second monitor — the renderer then falls back to the existing
   * in-page preview modal, so the control keeps working on a single screen.
   *
   * `allowPrimaryFallback`/`forceNoFullscreen` exist only for the automated
   * smoke test (single-monitor CI): they are never passed in production.
   */
  open(options: {
    userRequested: boolean;
    allowPrimaryFallback?: boolean;
    forceNoFullscreen?: boolean;
  }): {opened: boolean; reason?: string} {
    if (this.isOpen()) {
      const win = this.win!;
      if (win.isMinimized()) win.restore();
      win.focus();
      return {opened: true};
    }

    const secondary = this.pickSecondaryDisplay();
    if (options.userRequested) {
      // Remember the intent: if the monitor is plugged in later (or restored
      // after a cable nudge) the window comes back automatically.
      this.desired = true;
      this.persist();
    }

    let target: Display;
    if (secondary) {
      target = secondary;
    } else if (options.allowPrimaryFallback) {
      // Test-only: a small window on the primary display, never fullscreen.
      const primary = screen.getPrimaryDisplay();
      target = {
        ...primary,
        bounds: {
          x: primary.bounds.x + 40,
          y: primary.bounds.y + 40,
          width: Math.min(960, primary.bounds.width - 80),
          height: Math.min(640, primary.bounds.height - 80),
        },
      };
    } else {
      return {opened: false, reason: 'no-secondary-display'};
    }

    this.createWindow(target, {fullscreen: !options.forceNoFullscreen && !options.allowPrimaryFallback});
    return {opened: true};
  }

  /** User-initiated close (the window's own close button or the cashier). */
  closeFromUser(): void {
    this.desired = false;
    this.persist();
    this.closeWindow();
  }

  private closeWindow(): void {
    if (!this.isOpen()) return;
    this.systemClose = true;
    try {
      this.win!.close();
    } finally {
      this.systemClose = false;
    }
  }

  private createWindow(display: Display, options: {fullscreen: boolean} = {fullscreen: true}): void {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      title: 'SamTill POS — Customer Display',
      backgroundColor: '#102A4C',
      autoHideMenuBar: true,
      icon: this.deps.iconPath,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
      },
    });

    this.win = win;
    this.displayId = display.id;

    win.on('close', () => {
      if (!this.systemClose) {
        // Operator closed the window itself → stop auto-reopening it.
        this.desired = false;
        this.persist();
      }
    });
    win.on('closed', () => {
      this.win = null;
      this.displayId = null;
    });

    void win.loadURL(this.deps.getCustomerDisplayUrl());

    // Full-screen on the selected display once the page is up.
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.show();
      if (options.fullscreen) {
        win.setFullScreen(true);
        this.verifyPlacement(win, display.id);
      }
      // Hand the current sale to a freshly opened (or re-opened) window.
      if (this.lastState && !win.webContents.isDestroyed()) {
        win.webContents.send('customerDisplay:state', this.lastState);
      }
    });

    win.webContents.on('did-finish-load', () => {
      if (this.lastState && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('customerDisplay:state', this.lastState);
      }
    });

    // Never leave an invisible window behind a failed load: surface it (and
    // the error) instead of silently swallowing the failure.
    win.webContents.on('did-fail-load', (_event, code, description) => {
      // eslint-disable-next-line no-console
      console.error(`[customer-display] load failed: ${code} ${description}`);
      if (!win.isDestroyed()) win.show();
    });

    this.deps.notifyCashier('customerDisplay:opened');
  }

  /**
   * Verify the window really sits inside the chosen display's bounds; if the
   * OS ignored the placement, snap it back explicitly.
   */
  private verifyPlacement(win: BrowserWindow, displayId: number): void {
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!display || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const inside =
      bounds.x >= display.bounds.x - 2 &&
      bounds.y >= display.bounds.y - 2 &&
      bounds.x + bounds.width <= display.bounds.x + display.bounds.width + 2 &&
      bounds.y + bounds.height <= display.bounds.y + display.bounds.height + 2;
    if (inside) return;
    // eslint-disable-next-line no-console
    console.warn('[customer-display] window outside display bounds, re-placing', {
      bounds,
      display: display.bounds,
    });
    win.setFullScreen(false);
    win.setBounds(display.bounds);
    win.setFullScreen(true);
  }

  /* ---------------------------------------------------------------------- */
  /* Display hot-plug                                                        */
  /* ---------------------------------------------------------------------- */

  handleDisplayRemoved(removedId: number): void {
    this.deps.notifyCashier('display:changed', this.getDisplays());
    if (!this.isOpen()) return;
    const onRemoved = this.displayId === removedId;
    const stillVisible =
      this.displayId !== null &&
      screen.getAllDisplays().some((d) => d.id === this.displayId);
    if (onRemoved || !stillVisible) {
      // Close the customer window only — the cashier and the in-progress
      // transaction are untouched. `desired` stays true so it returns with a
      // display.
      this.closeWindow();
    }
  }

  handleDisplayAdded(): void {
    this.deps.notifyCashier('display:changed', this.getDisplays());
    if (this.isOpen()) {
      const win = this.win!;
      const visible = screen
        .getAllDisplays()
        .some((d) => win.getBounds().x < d.bounds.x + d.bounds.width && win.getBounds().y < d.bounds.y + d.bounds.height);
      if (visible) return;
      // The window's screen vanished while another appeared — move it to a
      // suitable display instead of leaving it stranded.
      const target = this.pickSecondaryDisplay() ?? screen.getPrimaryDisplay();
      win.setFullScreen(false);
      win.setBounds(target.bounds);
      win.setFullScreen(true);
      this.displayId = target.id;
      return;
    }
    if (this.desired) {
      const secondary = this.pickSecondaryDisplay();
      if (secondary) this.createWindow(secondary);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* State relay                                                             */
  /* ---------------------------------------------------------------------- */

  getLastState(): CustomerDisplayState | null {
    return this.lastState;
  }

  /** Cache the cashier's state and forward it to the open window. */
  setState(state: CustomerDisplayState): void {
    this.lastState = state;
    if (this.isOpen() && !this.win!.webContents.isDestroyed()) {
      this.win!.webContents.send('customerDisplay:state', state);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Persistence                                                             */
  /* ---------------------------------------------------------------------- */

  private readPersisted(): PersistedState {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as PersistedState;
    } catch {
      return {};
    }
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({customerDisplayDesired: this.desired}), 'utf8');
    } catch {
      // Non-fatal: the preference just won't survive a restart.
    }
  }
}
