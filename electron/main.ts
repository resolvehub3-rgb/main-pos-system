/**
 * SamTill POS — Electron main process.
 *
 * Responsibilities (and nothing more):
 *  - start the loopback server that serves the production web build,
 *  - create/manage the cashier window and the native customer display window,
 *  - detect displays and keep window placement sane across hot-plug events,
 *  - register the narrow, validated IPC surface,
 *  - enforce navigation/popup/permission security policy,
 *  - run the update *notification* check (never installs anything),
 *  - an env-gated smoke test (SAMTILL_SMOKE=1) used by QA.
 *
 * The POS business logic stays entirely in the existing renderer (`src/`).
 */
import {app, BrowserWindow, dialog, screen, session, shell} from 'electron';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {startRendererServer, type RendererServer} from './staticServer';
import {CustomerDisplayController} from './customerDisplay';
import {registerIpcHandlers} from './ipc';
import {checkForUpdates} from './updater';
import {installAppMenu} from './menu';

/** Injected by esbuild; '' when no release feed was configured at build time. */
declare const __UPDATE_MANIFEST_URL__: string;

/** QA-only end-to-end self test; never set in production builds. */
const SMOKE = process.env.SAMTILL_SMOKE === '1';

app.setName('SamTill POS');
app.setAppUserModelId('com.samtill.pos');

let server: RendererServer | null = null;
let rendererUrl = '';
/** Origin the windows actually load from (server origin, or the dev server). */
let rendererOrigin = '';
let cashierWindow: BrowserWindow | null = null;
let customerDisplay: CustomerDisplayController | null = null;
let lastUpdateStatus: import('../src/types/desktop').UpdateStatus | null = null;
const rendererErrors: string[] = [];
const reloadAttempts = new WeakMap<BrowserWindow, number>();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function fatal(title: string, message: string): never {
  // eslint-disable-next-line no-console
  console.error(`[samtill] ${title}: ${message}`);
  if (!SMOKE) dialog.showErrorBox(title, message);
  app.exit(1);
  throw new Error(message);
}

function customerDisplayUrl(): string {
  const sep = rendererUrl.includes('?') ? '&' : '?';
  return `${rendererUrl}${sep}view=customer-display`;
}

function resolveIconPath(): string | undefined {
  // Build resources are not packaged into the installer; on Windows the window
  // then falls back to the exe icon, which carries the same artwork.
  const candidate = path.join(app.getAppPath(), 'build-resources', 'app.ico');
  try {
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function createCashierWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    // Frameless: the OS title bar + default menu are gone; the renderer draws
    // its own title bar (drag region) with min/max/close controls wired over
    // the validated window-control IPC. Move = drag the header; resize = the
    // standard Windows edge/corner hit zones (resizable stays true).
    frame: false,
    backgroundColor: '#F5F7FA',
    title: 'SamTill POS',
    icon: resolveIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on('closed', () => {
    cashierWindow = null;
  });
  return win;
}

/* -------------------------------------------------------------------------- */
/* Security policy                                                             */
/* -------------------------------------------------------------------------- */

function installSecurityPolicy(): void {
  // The app needs no browser permissions at all: no camera, microphone,
  // geolocation, notifications, clipboard reads, HID/serial or MIDI.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    // Popups: only the report-printing flow may open a blank same-origin
    // window (pdf.ts writes the report into it and calls window.print()).
    // Every http(s) target goes to the OS browser; everything else is denied.
    contents.setWindowOpenHandler(({url}) => {
      if (url === '' || url === 'about:blank') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              preload: path.join(__dirname, 'preload.cjs'),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webviewTag: false,
            },
          },
        };
      }
      if (isHttpUrl(url)) void shell.openExternal(url);
      return {action: 'deny'};
    });

    // Never let a window wander off our own origin; external navigation
    // attempts open in the OS browser instead.
    contents.on('will-navigate', (event, url) => {
      const origin = rendererOrigin;
      if (origin && (url === origin || url.startsWith(`${origin}/`))) return;
      event.preventDefault();
      if (isHttpUrl(url)) void shell.openExternal(url);
    });

    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });

    // A crashed renderer must not take the till down silently.
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || details.reason === 'killed') return;
      // eslint-disable-next-line no-console
      console.error(`[samtill] renderer gone: ${details.reason} (exit ${details.exitCode})`);
      const win = BrowserWindow.fromWebContents(contents);
      if (!win || win.isDestroyed()) return;
      const attempts = reloadAttempts.get(win) ?? 0;
      if (attempts < 2 && contents !== customerDisplay?.getWebContents()) {
        reloadAttempts.set(win, attempts + 1);
        contents.reload();
      }
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Console error capture (QA/smoke)                                            */
/* -------------------------------------------------------------------------- */

function installConsoleCapture(): void {
  app.on('web-contents-created', (_event, contents) => {
    (contents as unknown as {
      on: (channel: string, listener: (...args: unknown[]) => void) => void;
    }).on('console-message', (...args: unknown[]) => {
      // Supports both Electron signatures: (event, level, message, line, src)
      // and the newer (event with .level/.message/.sourceId).
      let level: unknown;
      let message = '';
      const first = args[0] as {message?: string; level?: unknown} | undefined;
      if (first && typeof first === 'object' && typeof first.message === 'string') {
        level = first.level;
        message = first.message;
      } else {
        level = args[1];
        message = typeof args[2] === 'string' ? args[2] : '';
      }
      const isError = level === 'error' || level === 3;
      if (isError && message) {
        rendererErrors.push(message);
        // eslint-disable-next-line no-console
        console.error(`[renderer] ${message}`);
      }
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Startup                                                                     */
/* -------------------------------------------------------------------------- */

function resolveRendererUrl(origin: string): string {
  const dev = process.env.SAMTILL_DEV_URL;
  if (!app.isPackaged && dev) {
    try {
      const url = new URL(dev);
      const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && loopback) {
        return url.toString().replace(/\/$/, '');
      }
      // eslint-disable-next-line no-console
      console.warn('[samtill] ignoring invalid SAMTILL_DEV_URL');
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[samtill] ignoring invalid SAMTILL_DEV_URL');
    }
  }
  return origin;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const distDir = path.join(app.getAppPath(), 'dist');
  try {
    server = await startRendererServer(distDir, path.join(app.getPath('userData'), 'renderer-port'));
  } catch (err) {
    fatal(
      'SamTill POS — startup failed',
      err instanceof Error ? err.message : String(err),
    );
  }
  rendererUrl = resolveRendererUrl(server!.origin);
  try {
    rendererOrigin = new URL(rendererUrl).origin;
  } catch {
    fatal('SamTill POS — startup failed', `Invalid renderer URL: ${rendererUrl}`);
  }

  installSecurityPolicy();
  installConsoleCapture();
  installAppMenu();

  cashierWindow = createCashierWindow();
  const cashier = cashierWindow;

  // Frameless: keep the renderer's custom title bar in sync with the real
  // window state (the window can still be maximized/restored by snapping or
  // keyboard even though it has no native buttons).
  cashier.on('maximize', () => {
    if (!cashier.isDestroyed() && !cashier.webContents.isDestroyed()) {
      cashier.webContents.send('window:maximized-changed', true);
    }
  });
  cashier.on('unmaximize', () => {
    if (!cashier.isDestroyed() && !cashier.webContents.isDestroyed()) {
      cashier.webContents.send('window:maximized-changed', false);
    }
  });

  customerDisplay = new CustomerDisplayController({
    getCustomerDisplayUrl: customerDisplayUrl,
    preloadPath: path.join(__dirname, 'preload.cjs'),
    iconPath: resolveIconPath(),
    userDataPath: app.getPath('userData'),
    notifyCashier: (channel, payload) => {
      if (cashier && !cashier.isDestroyed() && !cashier.webContents.isDestroyed()) {
        cashier.webContents.send(channel, payload);
      }
    },
  });

  registerIpcHandlers({
    getAllowedOrigin: () => rendererOrigin,
    getCashierWebContents: () =>
      cashierWindow && !cashierWindow.isDestroyed() ? cashierWindow.webContents : null,
    getCashierWindow: () =>
      cashierWindow && !cashierWindow.isDestroyed() ? cashierWindow : null,
    customerDisplay,
    runUpdateCheck: () => checkForUpdates(app.getVersion()),
  });

  // Display hot-plug: never crash, never lose the sale, re-home the window.
  screen.on('display-removed', (_event, display) => {
    customerDisplay?.handleDisplayRemoved(display.id);
  });
  screen.on('display-added', () => {
    customerDisplay?.handleDisplayAdded();
  });

  // A reloaded cashier gets the last known update status again (no re-fetch).
  cashier.webContents.on('did-finish-load', () => {
    if (lastUpdateStatus && !cashier.isDestroyed() && !cashier.webContents.isDestroyed()) {
      cashier.webContents.send('update:status', lastUpdateStatus);
    }
  });

  // Predictable startup sequence: one cashier window, plus the customer
  // display when the operator had it enabled and a suitable monitor exists.
  void cashier.loadURL(rendererUrl).catch((err) => {
    fatal('SamTill POS — load failed', String(err));
  });

  if (SMOKE) {
    await runSmoke(cashier);
    return;
  }

  // Restore the customer display only after the OS settled display detection.
  setTimeout(() => {
    if (customerDisplay && !customerDisplay.isOpen() && customerDisplay.isDesired()) {
      customerDisplay.open({userRequested: false});
    }
  }, 750);

  // Update notification: runs once at startup, never blocks or interrupts.
  setTimeout(() => {
    void checkForUpdates(app.getVersion()).then((status) => {
      lastUpdateStatus = status;
      if (cashier && !cashier.isDestroyed() && !cashier.webContents.isDestroyed()) {
        cashier.webContents.send('update:status', status);
      }
    });
  }, 4_000);
}

/* -------------------------------------------------------------------------- */
/* QA smoke test (SAMTILL_SMOKE=1)                                             */
/* -------------------------------------------------------------------------- */

async function execute<T>(
  target: BrowserWindow | Electron.WebContents,
  code: string,
): Promise<T> {
  const contents = 'webContents' in target ? target.webContents : target;
  return contents.executeJavaScript(code, true) as Promise<T>;
}

async function runSmoke(cashier: BrowserWindow): Promise<void> {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    // eslint-disable-next-line no-console
    console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
    if (!ok) failures.push(name);
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the cashier window to load')), 45_000);
    if (!cashier.webContents.isLoading()) {
      clearTimeout(timer);
      resolve();
      return;
    }
    cashier.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    cashier.webContents.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer);
      reject(new Error(`cashier did-fail-load: ${code} ${desc}`));
    });
  });
  check('cashier window loaded', true, rendererUrl);

  // Preload bridge + IPC round trip.
  const version = await execute<string | null>(
    cashier,
    'window.samtillDesktop ? window.samtillDesktop.getVersion() : null',
  );
  check('preload bridge present', typeof version === 'string' && version.length > 0, `version=${version}`);

  // The production build must ship the restrictive CSP header.
  const csp = await execute<string | null>(
    cashier,
    "fetch('/index.html').then((r) => r.headers.get('content-security-policy')).catch(() => null)",
  );
  check(
    'CSP header served',
    typeof csp === 'string' && csp.includes("default-src 'self'") && csp.includes("script-src 'self'"),
    (csp ?? '').slice(0, 60) + '…',
  );

  const displays = await execute<unknown[]>(
    cashier,
    'window.samtillDesktop ? window.samtillDesktop.listDisplays() : []',
  );
  check('display:list via IPC', Array.isArray(displays), `${displays?.length ?? 0} display(s)`);

  const updateStatus = await execute<{state?: string} | null>(
    cashier,
    'window.samtillDesktop ? window.samtillDesktop.checkForUpdates() : null',
  );
  check(
    'updates:check via IPC',
    typeof updateStatus?.state === 'string',
    `state=${updateStatus?.state ?? 'missing'}`,
  );

  // Customer display: open even on a single-monitor CI box (test-only
  // fallback) and verify the state relay end to end.
  const opened = customerDisplay!.open({
    userRequested: false,
    allowPrimaryFallback: true,
    forceNoFullscreen: true,
  });
  check('customer display window opened', opened.opened, opened.reason ?? '');

  const customerWebContents = customerDisplay!.getWebContents();
  if (customerWebContents && !customerWebContents.isDestroyed()) {
    await new Promise<void>((resolve) => {
      if (!customerWebContents.isLoading()) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 20_000);
      customerWebContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((r) => setTimeout(r, 500));

    // An empty-cart push is exactly what the cashier sends when no sale is
    // active; a marker shop name proves the relay reaches the other window.
    const pushed = await execute<{ok?: boolean; error?: string}>(
      cashier,
      `window.samtillDesktop.setCustomerDisplayState({tenantName: 'Smoke Check', items: [], totalAmount: 0})`,
    );
    check('setState accepted by main', pushed?.ok === true, pushed?.error ?? '');
    await new Promise((r) => setTimeout(r, 750));

    const header = await execute<string>(
      customerWebContents,
      "document.querySelector('h1') ? document.querySelector('h1').textContent : ''",
    );
    check('state relayed to customer window', header === 'Smoke Check', `h1=${JSON.stringify(header)}`);

    const welcome = await execute<string>(
      customerWebContents,
      "document.body.textContent.includes('Next Customer') ? 'yes' : 'no'",
    );
    check('customer welcome screen rendered', welcome === 'yes');
  } else {
    check('customer display webContents available', false, 'window missing');
  }

  // Report printing: pdf.ts opens a blank popup, writes the report into it
  // and (from the opener) triggers window.print(). Verify the popup opens and
  // the print API exists — without opening the OS print dialog. A CSP
  // violation in the popup would also show up in the console-error check.
  const printFlow = await execute<boolean | string>(
    cashier,
    `(() => {
      const direct = typeof window.print === 'function';
      const w = window.open('', '_blank', 'width=1200,height=800');
      if (!w) return direct ? 'popup-blocked' : false;
      w.document.open();
      w.document.write('<!doctype html><html><body><h1>report</h1></body></html>');
      w.document.close();
      const rendered = w.document.body && w.document.body.textContent === 'report';
      const canPrint = typeof w.print === 'function';
      w.close();
      return direct && rendered && canPrint;
    })()`,
  );
  check('report print popup (opens, renders, print API)', printFlow === true, String(printFlow));

  // The loopback server must keep the SAME origin across launches (stable
  // port), otherwise localStorage — including the login session — would reset
  // on every restart. First run only stores the marker; later runs verify it.
  const markerKey = 'samtill_smoke_session_marker';
  const previousMarker = await execute<string | null>(
    cashier,
    `(() => {
      const prev = localStorage.getItem('${markerKey}');
      try { localStorage.setItem('${markerKey}', String(Date.now())); } catch {}
      return prev;
    })()`,
  );
  if (previousMarker !== null) {
    check('renderer storage persists across launches (stable origin)', true, `marker=${previousMarker}`);
  } else {
    // eslint-disable-next-line no-console
    console.log('[smoke] INFO — first run on this profile: origin marker stored; run again to verify persistence');
  }

  // Frameless desktop chrome: the custom window controls must be rendered and
  // the window-control IPC must really drive the window (report state, then
  // maximize and restore). This exercises the preload API, the validated
  // main-process handlers and the cashier-window sender gate end to end.
  const winProbe = await execute<{
    controls: boolean;
    maximized: boolean | null;
    toggled: boolean | null;
    restored: boolean | null;
  }>(
    cashier,
    `(async () => {
       const controls = !!document.querySelector('[data-testid="window-controls"]');
       const d = window.samtillDesktop;
       let maximized = null;
       let toggled = null;
       let restored = null;
       if (d && typeof d.windowIsMaximized === 'function') {
         try {
           maximized = await d.windowIsMaximized();
           await d.windowToggleMaximize();
           await new Promise((r) => setTimeout(r, 350));
           toggled = (await d.windowIsMaximized()) === true;
           await d.windowToggleMaximize();
           await new Promise((r) => setTimeout(r, 350));
           restored = (await d.windowIsMaximized()) === false;
         } catch (e) {}
       }
       return { controls, maximized, toggled, restored };
     })()`,
  );
  check('custom window controls rendered', winProbe?.controls === true);
  check(
    'window-control IPC round trip (isMaximized + toggleMaximize + restore)',
    typeof winProbe?.maximized === 'boolean' && winProbe?.toggled === true && winProbe?.restored === true,
    `maximized=${String(winProbe?.maximized)} toggled=${String(winProbe?.toggled)} restored=${String(winProbe?.restored)}`,
  );

  check('no renderer console errors', rendererErrors.length === 0, `${rendererErrors.length} error(s)`);

  const passed = failures.length === 0;
  // eslint-disable-next-line no-console
  console.log(`SMOKE RESULT: ${passed ? 'PASS' : `FAIL (${failures.join('; ')})`}`);
  app.exit(passed ? 0 : 1);
}

/* -------------------------------------------------------------------------- */
/* Entry                                                                       */
/* -------------------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  // A second launch just focuses the running till.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (cashierWindow && !cashierWindow.isDestroyed()) {
      if (cashierWindow.isMinimized()) cashierWindow.restore();
      cashierWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void server?.close().catch(() => undefined);
  });

  void bootstrap().catch((err) => {
    fatal('SamTill POS — startup failed', err instanceof Error ? err.stack ?? err.message : String(err));
  });
}
