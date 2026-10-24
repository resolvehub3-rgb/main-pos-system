/**
 * Verification harness for the local print bridge.
 *
 * Exercises the three things that actually matter and that no in-app unit test
 * can cover: the origin gate, the shared-token gate, and that an accepted job
 * really lands as ESC/POS bytes on the other side.
 *
 * Start the bridge in `file` transport mode first:
 *
 *   PRINT_TRANSPORT=file PRINT_BRIDGE_TOKEN=testtoken123 npm run print-bridge
 *
 * Then run:
 *
 *   PRINT_BRIDGE_TOKEN=testtoken123 npx tsx print-bridge/verify.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:9210';
const TOKEN = process.env.PRINT_BRIDGE_TOKEN ?? 'testtoken123';
const SPOOL = process.env.PRINT_SPOOL_DIR ?? join(process.cwd(), 'print-spool');
const APP_ORIGIN = 'http://localhost:3000';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(
  path: string,
  opts: { method?: string; origin?: string; token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.token) headers['X-Bridge-Token'] = opts.token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, headers: res.headers, json, text };
}

/* -------------------------------------------------------------------------- */
/* Origin gate                                                                 */
/* -------------------------------------------------------------------------- */

console.log('\nOrigin gate');

const allowed = await req('/bridge/info', { origin: APP_ORIGIN });
check(
  'allow-listed origin is accepted',
  allowed.status === 200 && allowed.json?.ok === true,
  `status ${allowed.status}`,
);
check(
  'CORS header echoes the allow-listed origin',
  allowed.headers.get('access-control-allow-origin') === APP_ORIGIN,
  String(allowed.headers.get('access-control-allow-origin')),
);

const evil = await req('/bridge/info', { origin: 'https://evil.example.com' });
check('foreign origin is rejected', evil.status === 403, `status ${evil.status}`);
check('foreign origin gets no CORS header', !evil.headers.get('access-control-allow-origin'));

const noOrigin = await req('/bridge/info');
check('non-browser request (no Origin) is allowed', noOrigin.status === 200, `status ${noOrigin.status}`);

const preflight = await req('/print', { method: 'OPTIONS', origin: APP_ORIGIN });
check('preflight succeeds', preflight.status === 204, `status ${preflight.status}`);
check(
  'preflight advertises the token header',
  (preflight.headers.get('access-control-allow-headers') ?? '').includes('X-Bridge-Token'),
);

// The gate matches on hostname, not on a "localhost*" prefix, and does not pin
// a port — vite silently moves to 3001 when 3000 is busy, and a fixed port used
// to turn that into an unexplained CORS failure.
const altPort = await req('/bridge/info', { origin: 'http://localhost:3001' });
check('another loopback port is accepted', altPort.status === 200, `status ${altPort.status}`);

const previewPort = await req('/bridge/info', { origin: 'http://127.0.0.1:4173' });
check('127.0.0.1 on the preview port is accepted', previewPort.status === 200, `status ${previewPort.status}`);

const ipv6 = await req('/bridge/info', { origin: 'http://[::1]:3000' });
check('IPv6 loopback is accepted', ipv6.status === 200, `status ${ipv6.status}`);

// Hostnames that merely *begin with* "localhost" belong to whoever owns that
// domain, not to this machine.
const lookalike = await req('/bridge/info', { origin: 'http://localhost.evil.com' });
check('localhost.evil.com is rejected', lookalike.status === 403, `status ${lookalike.status}`);
check('localhost.evil.com gets no CORS header', !lookalike.headers.get('access-control-allow-origin'));

const ipLookalike = await req('/bridge/info', { origin: 'http://127.0.0.1.evil.com:3000' });
check('127.0.0.1.evil.com is rejected', ipLookalike.status === 403, `status ${ipLookalike.status}`);

/* -------------------------------------------------------------------------- */
/* Token gate                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\nToken gate');

const noToken = await req('/health', { origin: APP_ORIGIN });
check('missing token is rejected', noToken.status === 403, `status ${noToken.status}`);

const badToken = await req('/health', { origin: APP_ORIGIN, token: 'wrong' });
check('wrong token is rejected', badToken.status === 403, `status ${badToken.status}`);

const goodToken = await req('/health', { origin: APP_ORIGIN, token: TOKEN });
check('correct token is accepted', goodToken.status === 200, `status ${goodToken.status}`);
check(
  'health reports the file transport',
  goodToken.json?.transport === 'file',
  String(goodToken.json?.transport),
);

/* -------------------------------------------------------------------------- */
/* Job validation                                                              */
/* -------------------------------------------------------------------------- */

console.log('\nJob validation');

const noData = await req('/print', {
  method: 'POST',
  origin: APP_ORIGIN,
  token: TOKEN,
  body: { label: 'no bytes' },
});
check('missing payload is rejected', noData.status === 400, `status ${noData.status}`);

const badB64 = await req('/print', {
  method: 'POST',
  origin: APP_ORIGIN,
  token: TOKEN,
  body: { data: '!!!not-base64!!!' },
});
check(
  'undecodable payload does not crash the bridge',
  badB64.status === 400 || badB64.status === 500,
  `status ${badB64.status}`,
);

const oversized = await req('/print', {
  method: 'POST',
  origin: APP_ORIGIN,
  token: TOKEN,
  body: { data: Buffer.alloc(300 * 1024).toString('base64') },
});
check('oversized job is rejected', oversized.status === 413, `status ${oversized.status}`);

const printers = await req('/printers', { origin: APP_ORIGIN, token: TOKEN });
check('printer listing works', printers.status === 200, `status ${printers.status}`);

/* -------------------------------------------------------------------------- */
/* Byte delivery                                                               */
/* -------------------------------------------------------------------------- */

console.log('\nByte delivery');

// A minimal ESC/POS job: init, centered line, feed, partial cut.
const job = Buffer.from(
  '\x1b@\x1b\x61\x01HELPER-VERIFY\x0a\x1b\x64\x04\x1d\x56\x42\x03',
  'binary',
);

const before = new Set(await readdir(SPOOL).catch(() => [] as string[]));

const printed = await req('/print', {
  method: 'POST',
  origin: APP_ORIGIN,
  token: TOKEN,
  body: { data: job.toString('base64'), label: 'verify' },
});

check('print job is accepted', printed.status === 200 && printed.json?.ok === true,
  `status ${printed.status} ${printed.json?.error ?? ''}`);
check('bridge reports file transport', printed.json?.transport === 'file',
  String(printed.json?.transport));

const after = await readdir(SPOOL).catch(() => [] as string[]);
const created = after.filter((f) => !before.has(f));
check('a spool file was written', created.length === 1, `created ${created.length}`);

if (created.length === 1) {
  const bytes = await readFile(join(SPOOL, created[0]));
  check('spool file matches the sent bytes exactly', bytes.equals(job),
    `${bytes.length} bytes`);
  const text = bytes.toString('binary');
  check('ESC/POS init present', text.startsWith('\x1b@'));
  check('receipt text survived the round trip', text.includes('HELPER-VERIFY'));
  check('centre-align command present', text.includes('\x1b\x61\x01'));
  check('cut command present', text.includes('\x1d\x56\x42\x03'));
}

/* -------------------------------------------------------------------------- */

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
