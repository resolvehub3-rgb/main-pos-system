/**
 * Browser-side client for the local print bridge.
 *
 * The bridge is an optional companion service (`npm run print-bridge`) running
 * on the till machine. When it's available we hand it ESC/POS bytes and the
 * thermal printer prints directly — no OS print dialog. When it isn't, every
 * call fails fast and the app falls back to the browser print flow, so the
 * cashier is never blocked.
 *
 * All functions are safe to call with the bridge offline.
 */
import { bytesToBase64, buildReceiptBytes, paperWidthFromSetting } from './escpos';
import { getTerminalSettings } from './terminalSettings';
import type { Sale, Tenant } from '../types';

/** Default address of the bridge on the same machine as the browser. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:9210';

/** How long to wait before assuming the bridge isn't running. */
const PROBE_TIMEOUT_MS = 900;
/** Print jobs get a little longer — a spooled job can take a moment. */
const PRINT_TIMEOUT_MS = 6_000;

const TOKEN_STORAGE_KEY = 'samtech_print_bridge_token_v1';

export type BridgeStatus =
  | { state: 'unknown' }
  | { state: 'online'; transport: string; printer?: string }
  | { state: 'offline'; reason: string };

export interface PrintJobResult {
  ok: boolean;
  transport?: string;
  target?: string;
  bytes?: number;
  durationMs?: number;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                                */
/* -------------------------------------------------------------------------- */

/** Where the bridge lives. Overridable per deployment via Vite env. */
export function bridgeUrl(): string {
  const fromEnv = import.meta.env?.VITE_PRINT_BRIDGE_URL as string | undefined;
  return (fromEnv || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
}

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Private mode: the token simply won't persist for this session.
  }
}

/* -------------------------------------------------------------------------- */
/* Low-level calls                                                              */
/* -------------------------------------------------------------------------- */

function withTimeout(ms: number): AbortSignal {
  // AbortSignal.timeout is not available in every supported browser yet.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Don't hold the event loop open for a probe.
  (timer as unknown as { unref?: () => void }).unref?.();
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

async function callBridge<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = { method: 'GET' },
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = readToken();
  if (token) headers['X-Bridge-Token'] = token;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${bridgeUrl()}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: withTimeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `Bridge responded ${response.status}`);
  }
  return payload;
}

/* -------------------------------------------------------------------------- */
/* Bootstrap + status                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the bridge token (and confirm the bridge is up).
 *
 * Called once at app start and again before printing if we have no token yet.
 * A missing token is not fatal — it just means the bridge rejected us.
 */
export async function bootstrapBridge(): Promise<boolean> {
  try {
    const info = await callBridge<{ ok: boolean; token: string }>('/bridge/info');
    if (info?.token) {
      writeToken(info.token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Probe the bridge. Never throws. */
export async function checkBridge(): Promise<BridgeStatus> {
  try {
    // We may not hold the token yet (first run, or storage was cleared).
    if (!readToken()) {
      const bootstrapped = await bootstrapBridge();
      if (!bootstrapped) return { state: 'offline', reason: 'Bridge not reachable' };
    }

    const health = await callBridge<{
      ok: boolean;
      transport?: string;
      printer?: string;
      error?: string;
    }>('/health');

    return {
      state: 'online',
      transport: health.transport ?? 'unknown',
      printer: health.printer,
    };
  } catch (err) {
    return {
      state: 'offline',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Printing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Render a sale to ESC/POS and hand it to the bridge.
 *
 * Returns a failed result (rather than throwing) whenever the bridge is absent
 * or rejects the job, so callers can fall back to the browser print path.
 */
export async function printSaleToBridge(sale: Sale, tenant: Tenant): Promise<PrintJobResult> {
  try {
    if (!readToken()) {
      const bootstrapped = await bootstrapBridge();
      if (!bootstrapped) return { ok: false, error: 'Print bridge is not running' };
    }

    const settings = getTerminalSettings();
    const bytes = buildReceiptBytes(
      sale,
      tenant,
      paperWidthFromSetting(settings.printer_paper_size),
    );

    const response = await callBridge<PrintJobResult>('/print', {
      method: 'POST',
      timeoutMs: PRINT_TIMEOUT_MS,
      body: {
        data: bytesToBase64(bytes),
        label: sale.invoice_number,
        printer: settings.bridge_printer || undefined,
      },
    });

    return { ...response, ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Send the bridge's built-in test page. Used by the owner dashboard. */
export async function sendTestPage(): Promise<PrintJobResult> {
  try {
    if (!readToken()) {
      const bootstrapped = await bootstrapBridge();
      if (!bootstrapped) return { ok: false, error: 'Print bridge is not running' };
    }
    const response = await callBridge<PrintJobResult>('/test', {
      method: 'POST',
      timeoutMs: PRINT_TIMEOUT_MS,
      body: {},
    });
    return { ...response, ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Printers Windows knows about, for the owner's printer picker. */
export async function listBridgePrinters(): Promise<
  Array<{ name: string; port: string; isDefault: boolean; isUsb: boolean }>
> {
  if (!readToken()) await bootstrapBridge();
  // Deliberately slower than a probe: `/printers` performs a real enumeration
  // (a PowerShell call) when the bridge's cache is cold, and this runs on a
  // human clicking "Refresh" who can wait a moment for accurate results.
  const response = await callBridge<{
    printers: Array<{ name: string; port: string; isDefault: boolean; isUsb: boolean }>;
  }>('/printers', { method: 'GET', timeoutMs: PRINT_TIMEOUT_MS });
  return response.printers ?? [];
}

/**
 * Whether the configured print path can take a sale.
 *
 * `auto` (the default) prefers the bridge but tolerates it being offline — the
 * caller falls back to browser print. `browser` never touches the bridge, and
 * `bridge` means the owner has asked for hardware-only output.
 */
export function shouldUseBridge(): boolean {
  const { print_method: method } = getTerminalSettings();
  return method === 'bridge' || method === 'auto';
}

/**
 * How a receipt print attempt ended.
 *
 * - `bridge` + `ok`   — the thermal printer took the job.
 * - `bridge` + !`ok`  — owner forced hardware output and it failed; the caller
 *                       must not fall back to the browser, and should say why.
 * - `browser`         — use the browser print dialog (bridge offline, or the
 *                       owner selected browser printing).
 */
export type ReceiptPrintOutcome =
  | { path: 'bridge'; ok: true; transport: string; target?: string }
  | { path: 'bridge'; ok: false; error: string }
  | { path: 'browser' };

/**
 * Print a sale on the thermal printer if configured to, otherwise the browser.
 *
 * Single entry point for the checkout and reprint flows. Returns which path
 * handled the job so the UI can report it honestly — this never falls back
 * silently when the owner has explicitly asked for hardware-only output.
 */
export async function printSaleReceipt(
  sale: Sale,
  tenant: Tenant,
): Promise<ReceiptPrintOutcome> {
  if (shouldUseBridge()) {
    const result = await printSaleToBridge(sale, tenant);
    if (result.ok) {
      return {
        path: 'bridge',
        ok: true,
        transport: result.transport ?? 'unknown',
        target: result.target,
      };
    }
    // Owner explicitly demanded hardware output — don't silently downgrade,
    // but do surface why, so they see a real message instead of nothing.
    if (getTerminalSettings().print_method === 'bridge') {
      return { path: 'bridge', ok: false, error: result.error ?? 'Print failed' };
    }
  }
  return { path: 'browser' };
}
