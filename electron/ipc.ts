/**
 * IPC surface — every renderer→main operation the desktop app allows.
 *
 * Rules enforced here:
 *  - Only the main frame of a window served by our own renderer origin may
 *    call anything; popups/iframes/foreign documents are rejected.
 *  - Cart state may only be written by the cashier window (the customer
 *    display can read it, never write it).
 *  - Every payload is validated field-by-field before it is cached, forwarded
 *    or used — nothing reaches another window unvalidated.
 *  - `shell:openExternal` only ever receives http(s) URLs.
 */
import {app, shell, type BrowserWindow, type IpcMainInvokeEvent, type WebContents} from 'electron';
import {ipcMain} from 'electron';
import type {CustomerDisplayState} from '../src/types/index';
import type {UpdateStatus} from '../src/types/desktop';
import type {CustomerDisplayController} from './customerDisplay';

export interface IpcDeps {
  /** Current renderer origin, e.g. http://127.0.0.1:9273. */
  getAllowedOrigin: () => string;
  /** The cashier application window's webContents (state writes are limited to it). */
  getCashierWebContents: () => WebContents | null;
  /** The cashier application window itself (frameless window controls). */
  getCashierWindow: () => BrowserWindow | null;
  customerDisplay: CustomerDisplayController;
  runUpdateCheck: () => Promise<UpdateStatus>;
}

/** True when the invoke came from the main frame of our own renderer. */
function isTrustedSender(event: IpcMainInvokeEvent, origin: string): boolean {
  if (!origin) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  const url = frame.url;
  return url === origin || url.startsWith(`${origin}/`);
}

function isCashierSender(event: IpcMainInvokeEvent, deps: IpcDeps): boolean {
  const cashier = deps.getCashierWebContents();
  return cashier !== null && !cashier.isDestroyed() && event.sender.id === cashier.id;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/**
 * Validate the cart payload a cashier pushes to the customer display.
 * Returns a sanitised copy, or null when anything is off — the sender is then
 * told the payload was rejected and nothing is forwarded.
 */
export function validateCustomerDisplayState(raw: unknown): CustomerDisplayState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  if (!isBoundedString(input.tenantName, 200)) return null;
  if (!isFiniteNumber(input.totalAmount) || Math.abs(input.totalAmount) > 1e12) return null;
  if (!Array.isArray(input.items) || input.items.length > 1000) return null;

  const items = [];
  for (const entry of input.items) {
    if (typeof entry !== 'object' || entry === null) return null;
    const item = entry as Record<string, unknown>;
    if (!isBoundedString(item.id, 128) || item.id.length === 0) return null;
    if (!isBoundedString(item.name, 400)) return null;
    if (!isBoundedString(item.imageUrl, 8192)) return null;
    if (!isFiniteNumber(item.unitPrice) || item.unitPrice < 0 || item.unitPrice > 1e12) return null;
    if (!isFiniteNumber(item.quantity) || item.quantity <= 0 || item.quantity > 1e6) return null;
    items.push({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    });
  }

  return {
    tenantName: input.tenantName,
    items,
    totalAmount: input.totalAmount,
  };
}

function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const trusted = (event: IpcMainInvokeEvent): boolean => isTrustedSender(event, deps.getAllowedOrigin());

  ipcMain.handle('app:getVersion', (event) => {
    if (!trusted(event)) throw new Error('Denied');
    return app.getVersion();
  });

  ipcMain.handle('display:list', (event) => {
    if (!trusted(event)) throw new Error('Denied');
    return deps.customerDisplay.getDisplays();
  });

  ipcMain.handle('customerDisplay:open', (event) => {
    if (!trusted(event)) throw new Error('Denied');
    return deps.customerDisplay.open({userRequested: true});
  });

  ipcMain.handle('customerDisplay:close', (event) => {
    if (!trusted(event)) throw new Error('Denied');
    deps.customerDisplay.closeFromUser();
  });

  ipcMain.handle('customerDisplay:getState', (event) => {
    if (!trusted(event)) throw new Error('Denied');
    return deps.customerDisplay.getLastState();
  });

  ipcMain.handle('customerDisplay:setState', (event, payload: unknown) => {
    if (!trusted(event)) throw new Error('Denied');
    // Only the cashier may author the customer display's state.
    if (!isCashierSender(event, deps)) {
      return {ok: false, error: 'Only the cashier window can update the customer display.'};
    }
    const state = validateCustomerDisplayState(payload);
    if (!state) return {ok: false, error: 'Invalid customer display payload.'};
    deps.customerDisplay.setState(state);
    return {ok: true};
  });

  ipcMain.handle('shell:openExternal', async (event, payload: unknown) => {
    if (!trusted(event)) return {ok: false, error: 'Denied'};
    if (!isSafeExternalUrl(payload)) return {ok: false, error: 'Only http(s) URLs can be opened.'};
    try {
      await shell.openExternal(payload);
      return {ok: true};
    } catch (err) {
      return {ok: false, error: err instanceof Error ? err.message : 'Could not open the browser.'};
    }
  });

  ipcMain.handle('updates:check', async (event) => {
    if (!trusted(event)) throw new Error('Denied');
    return deps.runUpdateCheck();
  });

  /* ---------------------------------------------------------------------- */
  /* Frameless window controls (cashier window only)                         */
  /* ---------------------------------------------------------------------- */

  /**
   * Resolve the cashier window for a window-control call. Only the main frame
   * of our own origin AND the cashier window itself may drive its own chrome;
   * the customer display, popups and any foreign frame are rejected.
   */
  const cashierWindowFor = (event: IpcMainInvokeEvent): BrowserWindow | null => {
    if (!trusted(event) || !isCashierSender(event, deps)) return null;
    const win = deps.getCashierWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  ipcMain.handle('window:minimize', (event) => {
    const win = cashierWindowFor(event);
    if (!win) throw new Error('Denied');
    win.minimize();
  });

  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = cashierWindowFor(event);
    if (!win) throw new Error('Denied');
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return {maximized: win.isMaximized()};
  });

  ipcMain.handle('window:isMaximized', (event) => {
    const win = cashierWindowFor(event);
    if (!win) throw new Error('Denied');
    return win.isMaximized();
  });

  ipcMain.handle('window:close', (event) => {
    const win = cashierWindowFor(event);
    if (!win) throw new Error('Denied');
    win.close();
  });
}
