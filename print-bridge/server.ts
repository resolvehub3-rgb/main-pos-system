/**
 * SamTill POS — local print bridge.
 *
 * A tiny HTTP service that runs on the POS machine itself and writes ESC/POS
 * bytes straight to the till's thermal printer. Browsers cannot talk to USB
 * hardware directly, so this bridge is what makes "cashier clicks → paper come
 * out" possible without the OS print dialog.
 *
 * ## Security model
 *
 * Two independent layers, because either alone is bypassable:
 *
 *  1. **Loopback origin gate.** The browser is the thing we're defending against
 *     (any tab can reach 127.0.0.1). Requests carrying an `Origin` header that
 *     isn't served from this machine are rejected outright, and CORS headers are
 *     only ever echoed back to loopback origins. This is enforced by the
 *     browser, so it actually holds. Any loopback port is accepted — the till's
 *     dev server picks its own port — but set `PRINT_BRIDGE_ORIGINS` to pin an
 *     exact list if you want that instead.
 *  2. **Shared token.** Required on every printing endpoint, so a page served
 *     from an allowed origin but that isn't the POS app still can't print, and
 *     so curl-style clients from another local user need the secret too.
 *
 * The bridge binds to 127.0.0.1 only — it is never reachable from another
 * machine on the network.
 *
 * ## Start
 *
 *     npm run print-bridge
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanSpool,
  configFromEnv,
  describeConfig,
  listPrinters,
  primePrinterCache,
  printJob,
  printTestPage,
  type PrintResult,
} from './print.ts';

const PORT = Number(process.env.PRINT_BRIDGE_PORT ?? 9210);
const HOST = process.env.PRINT_BRIDGE_HOST ?? '127.0.0.1';
/** Receipts are a few KB; anything larger is not one. */
const MAX_JOB_BYTES = 256 * 1024;
const TOKEN_FILE = join(process.cwd(), 'print-bridge', '.bridge-token');

/**
 * Origins allowed to reach the bridge.
 *
 * The till browser runs on the same machine as the printer, so an origin is
 * only trusted when it is a loopback address of *this* machine. What the gate
 * defends against is any other website the operator happens to have open
 * (`https://evil.example.com`) — those are never loopback, so they are refused.
 *
 * The port is deliberately not pinned. `vite` takes 3000 and silently falls
 * back to 3001 when it is busy, `preview` uses 4173, and a fixed port turned
 * "some other process has 3000" into "the bridge is unreachable" with nothing
 * but an opaque CORS error to go on. A page served from loopback is served from
 * this machine regardless of which port it chose, so the port adds no
 * meaningful protection here.
 *
 * Setting `PRINT_BRIDGE_ORIGINS` switches to a strict exact-match list instead,
 * for a dedicated till that wants one pinned origin.
 */
const EXPLICIT_ORIGINS = new Set(
  (process.env.PRINT_BRIDGE_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

/** `URL.hostname` keeps the brackets on IPv6, hence both spellings. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackOrigin(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Note the hostname test rather than a prefix match: `http://localhost.evil.com`
 * parses to hostname `localhost.evil.com`, which is not in the set, so it is
 * refused even though its URL *starts with* "localhost".
 */
function isAllowedOrigin(raw: string): boolean {
  const origin = raw.replace(/\/$/, '');
  if (EXPLICIT_ORIGINS.size > 0) return EXPLICIT_ORIGINS.has(origin);
  return isLoopbackOrigin(origin);
}

const originPolicy = {
  mode: EXPLICIT_ORIGINS.size > 0 ? ('exact' as const) : ('loopback-any-port' as const),
  exactOrigins: [...EXPLICIT_ORIGINS],
  describe:
    EXPLICIT_ORIGINS.size > 0
      ? [...EXPLICIT_ORIGINS].join(', ')
      : 'any loopback origin (localhost / 127.0.0.1 / [::1], any port)',
};

const config = configFromEnv();

/* -------------------------------------------------------------------------- */
/* Shared token                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A long-lived random token the POS app sends on every call.
 *
 * Generated on first run and persisted so the app survives restarts. On a
 * read-only install we fall back to a per-process token, which the app picks up
 * through the bootstrap endpoint.
 *
 * Returns whether the token actually landed on disk, so the startup banner
 * doesn't claim persistence that didn't happen.
 */
function resolveToken(): { token: string; persisted: boolean } {
  const fromEnv = process.env.PRINT_BRIDGE_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, persisted: false };

  try {
    if (existsSync(TOKEN_FILE)) {
      const existing = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (existing) return { token: existing, persisted: true };
    }
    const generated = randomBytes(32).toString('hex');
    writeFileSync(TOKEN_FILE, generated, { encoding: 'utf8', mode: 0o600 });
    return { token: generated, persisted: true };
  } catch {
    return { token: randomBytes(32).toString('hex'), persisted: false };
  }
}

const { token: BRIDGE_TOKEN, persisted: TOKEN_PERSISTED } = resolveToken();

/* -------------------------------------------------------------------------- */
/* Middleware                                                                   */
/* -------------------------------------------------------------------------- */

const app = express();
app.disable('x-powered-by');

/**
 * Origin gate + CORS.
 *
 * Must run before every route: without the CORS headers on the preflight
 * response, the browser never sends `POST /print` at all. Runs before the body
 * parser so a rejected origin can't consume memory either.
 */
function originGate(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');

  if (origin) {
    if (!isAllowedOrigin(origin)) {
      res.status(403).json({
        ok: false,
        error: 'Origin is not permitted to use this print bridge.',
      });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  // Requests without an Origin are not browser-initiated (curl, a native agent).
  // They still have to present the token on protected routes.

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/** Reject anything that isn't the POS app carrying our token. */
function requireToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.get('x-bridge-token');
  if (!token || token !== BRIDGE_TOKEN) {
    res.status(403).json({ ok: false, error: 'Missing or invalid X-Bridge-Token header.' });
    return;
  }
  next();
}

/** In-memory throttle so a runaway loop can't spin the printer. */
const recentJobs: number[] = [];
const MAX_JOBS_PER_10S = 20;
const THROTTLE_WINDOW_MS = 10_000;

/** Returns true (and records the job) when the job may proceed. */
function admitJob(): boolean {
  const now = Date.now();
  while (recentJobs.length > 0 && now - recentJobs[0] > THROTTLE_WINDOW_MS) {
    recentJobs.shift();
  }
  if (recentJobs.length >= MAX_JOBS_PER_10S) return false;
  recentJobs.push(now);
  return true;
}

app.use(originGate);
app.use(express.json({ limit: `${MAX_JOB_BYTES}b` }));

/* -------------------------------------------------------------------------- */
/* Routes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bootstrap: hands the app its token plus the live configuration.
 *
 * Protected by the origin gate rather than the token — that's the chicken-and-
 * egg problem: the app cannot send a token it has not been given yet. Because
 * only allowlisted POS origins may call it, no other page can read the secret.
 */
app.get('/bridge/info', (_req, res) => {
  res.json({
    ok: true,
    name: 'samtech-print-bridge',
    token: BRIDGE_TOKEN,
    config: {
      transport: config.transport,
      printer: config.printer,
      networkHost: config.networkHost,
      networkPort: config.networkPort,
      originPolicy,
    },
  });
});

/**
 * Status probe.
 *
 * Answers from the printer cache and never blocks on PowerShell — the app
 * probes this on a sub-second timeout to decide whether the thermal printer is
 * available, so a slow response would read as "bridge not running".
 */
app.get('/health', requireToken, (_req, res) => {
  res.json({ ok: true, ...describeConfig(config) });
});

/**
 * Installed printers, for the owner's printer picker.
 *
 * This one may wait for a real enumeration, since a human is clicking
 * "Refresh" and can tolerate a second or two.
 */
app.get('/printers', requireToken, async (_req, res) => {
  try {
    res.json({ ok: true, printers: await listPrinters() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/** Base64 is checked up front — Node's decoder is lenient and would otherwise
 *  silently mangle invalid input into a plausible-looking byte stream. */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

app.post('/print', requireToken, async (req, res) => {
  const { data, printer, copies, label } = (req.body ?? {}) as {
    data?: string;
    printer?: string;
    copies?: number;
    label?: string;
  };

  if (typeof data !== 'string' || data.length === 0) {
    res.status(400).json({ ok: false, error: 'Field `data` (base64 ESC/POS) is required.' });
    return;
  }
  if (data.length % 4 !== 0 || !BASE64_RE.test(data)) {
    res.status(400).json({ ok: false, error: 'Field `data` is not valid base64.' });
    return;
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    res.status(400).json({ ok: false, error: 'Decoded job was empty.' });
    return;
  }
  if (bytes.length > MAX_JOB_BYTES) {
    res.status(413).json({ ok: false, error: 'Job is larger than a receipt should be.' });
    return;
  }

  // Throttle only after validation, so malformed requests don't burn the budget.
  if (!admitJob()) {
    res.status(429).json({ ok: false, error: 'Too many print jobs — slow down.' });
    return;
  }

  try {
    const result: PrintResult = await printJob(
      {
        data: new Uint8Array(bytes),
        printer: typeof printer === 'string' && printer.trim() ? printer.trim() : undefined,
        copies: typeof copies === 'number' ? copies : 1,
      },
      config,
    );
    res.json({ ok: true, label, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/test', requireToken, async (_req, res) => {
  try {
    const result = await printTestPage(config);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Unknown bridge endpoint.' });
});

/**
 * Final error handler.
 *
 * Body-parser raises `entity.too.large` before our route ever runs; without
 * this, Express dumps a stack trace to the console and answers 500 instead of
 * telling the caller the job was simply too big.
 */
app.use((err: { type?: string; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ ok: false, error: 'Job is larger than a receipt should be.' });
    return;
  }
  res.status(500).json({ ok: false, error: err?.message ?? 'Unexpected bridge error.' });
});

/* -------------------------------------------------------------------------- */
/* Start                                                                        */
/* -------------------------------------------------------------------------- */

app.listen(PORT, HOST, () => {
  const lines = [
    '',
    '  SamTill print bridge',
    `  Address:   http://${HOST}:${PORT}`,
    `  Token:     ${BRIDGE_TOKEN}`,
    `  Transport: ${config.transport}`,
    config.printer ? `  Printer:   ${config.printer}` : '  Printer:   (auto-detect)',
    config.networkHost ? `  Network:   ${config.networkHost}:${config.networkPort}` : '',
    `  Origins:   ${originPolicy.describe}`,
    TOKEN_PERSISTED
      ? '  Token persisted to print-bridge/.bridge-token'
      : '  Token is per-process (set PRINT_BRIDGE_TOKEN to pin it across restarts)',
    '',
  ].filter(Boolean);
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  // Warm the printer cache so the first status probe from the app is answered
  // immediately instead of waiting on a cold PowerShell enumeration.
  primePrinterCache();
});

// Sweep old spool files once an hour.
setInterval(() => {
  void cleanSpool(config.spoolDir);
}, 60 * 60 * 1000).unref();
