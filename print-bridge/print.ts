/**
 * Print transports for the local print bridge.
 *
 * Three ways to get ESC/POS bytes onto paper, in order of how direct they are:
 *
 *  - `usb`     — Windows spooler raw write. The printer is installed in Windows
 *                (which is how a USB thermal till printer shows up) and we hand
 *                it the raw byte stream with `WritePrinter`. No native modules.
 *  - `network` — raw TCP to a printer on the LAN (port 9100 by default).
 *  - `file`    — writes the stream to a spool directory. Used when no printer is
 *                configured yet, and as the verifiable fallback when developing
 *                on a machine with no printer attached.
 *
 * Selection is configuration-driven (`PRINT_TRANSPORT`, `PRINT_PRINTER`,
 * `PRINT_NETWORK_HOST`), defaulting to `auto`.
 */
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type TransportKind = 'usb' | 'network' | 'file';

export interface PrinterInfo {
  name: string;
  port: string;
  isDefault: boolean;
  isUsb: boolean;
}

export interface PrintJob {
  data: Uint8Array;
  /** Windows printer name (usb) or label for other transports. */
  printer?: string;
  copies?: number;
}

export interface PrintResult {
  transport: TransportKind;
  target: string;
  bytes: number;
  durationMs: number;
}

export interface BridgeConfig {
  transport: TransportKind | 'auto';
  printer?: string;
  networkHost?: string;
  networkPort: number;
  spoolDir: string;
}

/** Reads bridge configuration from the environment. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const raw = (env.PRINT_TRANSPORT ?? 'auto').toLowerCase();
  const transport: BridgeConfig['transport'] =
    raw === 'usb' || raw === 'network' || raw === 'file' ? raw : 'auto';

  return {
    transport,
    printer: env.PRINT_PRINTER?.trim() || undefined,
    networkHost: env.PRINT_NETWORK_HOST?.trim() || undefined,
    networkPort: Number(env.PRINT_NETWORK_PORT ?? 9100) || 9100,
    spoolDir: env.PRINT_SPOOL_DIR?.trim() || join(process.cwd(), 'print-spool'),
  };
}

/* -------------------------------------------------------------------------- */
/* Printer discovery (Windows)                                                 */
/* -------------------------------------------------------------------------- */

/** Resolve a printer name from config, discovery, or `auto`. */
async function resolvePrinterName(config: BridgeConfig): Promise<string | undefined> {
  if (config.printer) return config.printer;

  try {
    const printers = (await listPrinters()) ?? [];
    const usb = printers.find((p) => p.isUsb && p.isDefault)
      ?? printers.find((p) => p.isUsb)
      ?? printers.find((p) => p.isDefault);
    return usb?.name;
  } catch {
    return undefined;
  }
}

/**
 * Enumerate installed Windows printers via WMI.
 *
 * `Win32_Printer` is available on every Windows edition (unlike the
 * PrintManagement `Get-Printer` cmdlet), and its `PortName` tells us which
 * printers sit on a USB port.
 */
async function enumeratePrinters(): Promise<PrinterInfo[]> {
  const script =
    'Get-CimInstance -ClassName Win32_Printer | ' +
    'Select-Object Name, PortName, Default | ' +
    'ConvertTo-Json -Compress';

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true },
  );

  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => {
      const name = String(row.Name ?? row.name ?? '');
      const port = String(row.PortName ?? row.portName ?? '');
      return {
        name,
        port,
        isDefault: Boolean(row.Default ?? row.default),
        isUsb: /^USB\d*$/i.test(port) || /^USB/i.test(port),
      };
    })
    .filter((printer) => printer.name.length > 0);
}

/**
 * Enumeration cache.
 *
 * Spawning PowerShell costs seconds, and the printer set changes only when
 * someone physically plugs something in — so the result is memoised. Without
 * this, `/health` (which the app probes on a 900ms budget) could never answer
 * in time and the till would always show the bridge as "not running".
 */
const PRINTER_CACHE_MS = 60_000;

interface PrinterCache {
  printers: PrinterInfo[];
  at: number;
  error?: string;
  /** In-flight enumeration, so concurrent probes share one PowerShell spawn. */
  inflight: Promise<PrinterInfo[]> | null;
}

const printerCache: PrinterCache = { printers: [], at: 0, inflight: null };

/** Refresh the cache. Never rejects — a failure keeps the last-known list. */
function refreshPrinters(): Promise<PrinterInfo[]> {
  if (printerCache.inflight) return printerCache.inflight;

  const pending = enumeratePrinters()
    .then((printers) => {
      printerCache.printers = printers;
      printerCache.error = undefined;
      return printers;
    })
    .catch((err: unknown) => {
      // Keep serving the last-known list; remember why the refresh failed.
      printerCache.error = err instanceof Error ? err.message : String(err);
      return printerCache.printers;
    })
    .finally(() => {
      printerCache.at = Date.now();
      printerCache.inflight = null;
    });

  printerCache.inflight = pending;
  return pending;
}

/** Installed printers, refreshed at most once a minute. */
export function listPrinters(): Promise<PrinterInfo[]> {
  if (printerCache.at && Date.now() - printerCache.at < PRINTER_CACHE_MS) {
    return Promise.resolve(printerCache.printers);
  }
  return refreshPrinters();
}

/**
 * Whatever is cached right now — never blocks on PowerShell.
 *
 * Used by `/health`, which the app probes under a tight timeout: it is far
 * better to answer "bridge is up" immediately and refresh in the background
 * than to make the till wait several seconds for a printer list it doesn't
 * need yet.
 */
export function cachedPrinters(): { printers: PrinterInfo[]; error?: string } {
  if (!printerCache.inflight && Date.now() - printerCache.at > PRINTER_CACHE_MS) {
    void refreshPrinters();
  }
  return { printers: printerCache.printers, error: printerCache.error };
}

/** Warm the cache at startup so the first probe isn't served cold. */
export function primePrinterCache(): void {
  void refreshPrinters();
}

/* -------------------------------------------------------------------------- */
/* USB / Windows spooler raw print                                              */
/* -------------------------------------------------------------------------- */

/**
 * PowerShell helper: opens the printer, pushes the raw byte stream with
 * `WritePrinter`, and closes the job. Kept ASCII-only so it encodes cleanly.
 */
const RAW_PRINTER_SCRIPT = `
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SamtechRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pDefault);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, ref DOCINFO di);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
'@

function Assert-Win32([bool]$Ok, [string]$What) {
  if (-not $Ok) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "$What failed with Win32 error $code"
  }
}

$printerName = $env:SAMTECH_PRINTER
$dataPath    = $env:SAMTECH_DATA
$copies      = [int]$env:SAMTECH_COPIES
if ($copies -lt 1) { $copies = 1 }

$bytes = [System.IO.File]::ReadAllBytes($dataPath)

$handle = [IntPtr]::Zero
Assert-Win32 ([SamtechRawPrinter]::OpenPrinter($printerName, [ref]$handle, [IntPtr]::Zero)) "OpenPrinter"

try {
  for ($i = 0; $i -lt $copies; $i++) {
    $doc = New-Object SamtechRawPrinter+DOCINFO
    $doc.pDocName     = 'SamTill POS Receipt'
    $doc.pOutputFile  = $null
    $doc.pDatatype    = 'RAW'

    Assert-Win32 ([SamtechRawPrinter]::StartDocPrinter($handle, 1, [ref]$doc)) "StartDocPrinter"
    try {
      Assert-Win32 ([SamtechRawPrinter]::StartPagePrinter($handle)) "StartPagePrinter"

      $ptr = [Runtime.InteropServices]::AllocHGlobal($bytes.Length)
      try {
        [Runtime.InteropServices]::Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
        $written = 0
        Assert-Win32 ([SamtechRawPrinter]::WritePrinter($handle, $ptr, $bytes.Length, [ref]$written)) "WritePrinter"
        if ($written -ne $bytes.Length) {
          throw "Short write: $written of $($bytes.Length) bytes accepted by the printer"
        }
      }
      finally {
        [Runtime.InteropServices]::Marshal]::FreeHGlobal($ptr)
      }

      Assert-Win32 ([SamtechRawPrinter]::EndPagePrinter($handle)) "EndPagePrinter"
    }
    finally {
      [SamtechRawPrinter]::EndDocPrinter($handle) | Out-Null
    }
  }

  Write-Output (ConvertTo-Json @{ ok = $true; printer = $printerName; bytes = $bytes.Length; copies = $copies } -Compress)
}
finally {
  [SamtechRawPrinter]::ClosePrinter($handle) | Out-Null
}
`.trim();

async function printViaSpooler(
  data: Uint8Array,
  printer: string,
  copies: number,
): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scriptPath = join(tmpdir(), `samtech-print-${stamp}.ps1`);
  const dataPath = join(tmpdir(), `samtech-job-${stamp}.bin`);

  await writeFile(scriptPath, RAW_PRINTER_SCRIPT, 'utf8');
  await writeFile(dataPath, data);

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          SAMTECH_PRINTER: printer,
          SAMTECH_DATA: dataPath,
          SAMTECH_COPIES: String(copies),
        },
      },
    );

    const result = parseJsonLine(stdout);
    if (!result?.ok) {
      throw new Error(stderr.trim() || stdout.trim() || 'The printer rejected the job.');
    }
  } finally {
    await Promise.allSettled([unlink(scriptPath), unlink(dataPath)]);
  }
}

function parseJsonLine(stdout: string): { ok?: boolean } | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed) as { ok?: boolean };
    } catch {
      continue;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Network printer                                                              */
/* -------------------------------------------------------------------------- */

function printViaNetwork(
  data: Uint8Array,
  host: string,
  port: number,
  copies: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const payload = Buffer.alloc(data.length * copies);
    for (let i = 0; i < copies; i++) {
      payload.set(data, i * data.length);
    }

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to printer at ${host}:${port}`));
    }, 10_000);

    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.once('connect', () => {
      socket.end(payload, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Spool file (no printer attached / development)                               */
/* -------------------------------------------------------------------------- */

async function printToSpoolFile(
  data: Uint8Array,
  spoolDir: string,
  copies: number,
): Promise<string> {
  await mkdir(spoolDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(spoolDir, `receipt-${stamp}.bin`);
  const payload = Buffer.alloc(data.length * copies);
  for (let i = 0; i < copies; i++) {
    payload.set(data, i * data.length);
  }
  await writeFile(filePath, payload);
  return filePath;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch a job to the configured transport.
 *
 * `auto` picks network when a host is configured, then a USB printer when one
 * can be discovered, and finally falls back to the spool directory so a receipt
 * is never silently dropped.
 */
export async function printJob(
  job: PrintJob,
  config: BridgeConfig,
): Promise<PrintResult> {
  const started = Date.now();
  const copies = Math.max(1, Math.min(job.copies ?? 1, 10));
  const { data } = job;

  let transport: TransportKind;
  let target: string;

  const wantsNetwork = config.transport === 'network' || (config.transport === 'auto' && config.networkHost);

  if (wantsNetwork && config.networkHost) {
    transport = 'network';
    target = `${config.networkHost}:${config.networkPort}`;
    await printViaNetwork(data, config.networkHost, config.networkPort, copies);
  } else if (config.transport === 'file') {
    transport = 'file';
    target = await printToSpoolFile(data, config.spoolDir, copies);
  } else {
    const printerName = job.printer ?? (await resolvePrinterName(config));
    if (!printerName) {
      // No printer configured or discovered — keep the job instead of dropping it.
      transport = 'file';
      target = await printToSpoolFile(data, config.spoolDir, copies);
    } else {
      transport = 'usb';
      target = printerName;
      await printViaSpooler(data, printerName, copies);
    }
  }

  return {
    transport,
    target,
    bytes: data.length,
    durationMs: Date.now() - started,
  };
}

/**
 * Human-readable summary of how the bridge is currently configured.
 *
 * Deliberately non-blocking: it reads the printer cache and, when that cache is
 * cold, kicks off a refresh in the background instead of waiting. `/health` is
 * called by the app on every status probe under a sub-second timeout, so it has
 * to answer immediately — a slow health check reads as "bridge not running".
 */
export function describeConfig(config: BridgeConfig): {
  transport: TransportKind | 'auto';
  printer?: string;
  networkTarget?: string;
  spoolDir: string;
  availablePrinters: PrinterInfo[];
  printersRefreshing?: boolean;
  error?: string;
} {
  const { printers, error } = cachedPrinters();

  // Prefer whatever the cache says; fall back to the configured name.
  const discovered = config.printer
    ?? printers.find((p) => p.isUsb && p.isDefault)?.name
    ?? printers.find((p) => p.isUsb)?.name
    ?? printers.find((p) => p.isDefault)?.name;

  return {
    transport: config.transport,
    printer: discovered,
    networkTarget: config.networkHost ? `${config.networkHost}:${config.networkPort}` : undefined,
    spoolDir: config.spoolDir,
    availablePrinters: printers,
    printersRefreshing: Boolean(printerCache.inflight),
    error,
  };
}

/** Test page used by the owner dashboard's "Test Print" button. */
export async function printTestPage(config: BridgeConfig): Promise<PrintResult> {
  const now = new Date().toISOString();
  const lines = [
    '\x1b@',
    '\x1b\x61\x01',
    '\x1b\x45\x01',
    'SAMTECH HELPER POS\x0a',
    '\x1b\x45\x00',
    'PRINTER TEST PAGE\x0a',
    '\x1b\x61\x00',
    '--------------------------------\x0a',
    'Bridge:     local print bridge\x0a',
    `Transport:  ${config.transport}\x0a`,
    `Time:       ${now}\x0a`,
    '--------------------------------\x0a',
    'If you can read this, thermal\x0a',
    'printing is working correctly.\x0a',
    '\x1b\x64\x04',
    '\x1d\x56\x42\x03',
  ].join('');

  return printJob({ data: Buffer.from(lines, 'binary') }, config);
}

/** Housekeeping: remove spool files older than `maxAgeMs` (default 1 day). */
export async function cleanSpool(spoolDir: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  try {
    await stat(spoolDir);
  } catch {
    return 0;
  }

  const entries = await readdir(spoolDir);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const entry of entries) {
    if (!entry.startsWith('receipt-') || !entry.endsWith('.bin')) continue;
    const path = join(spoolDir, entry);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await unlink(path);
        removed += 1;
      }
    } catch {
      // A file that vanished between readdir and unlink is fine.
    }
  }

  return removed;
}
