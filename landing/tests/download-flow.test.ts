/**
 * Installer download flow tests — server-side handler behaviour and client
 * response classification. No real network: the global fetch is stubbed per
 * test to emulate the commerce backend (PostgREST + Storage) locally, and
 * environment variables are set and restored inside each test.
 *
 * Covered journeys:
 *  - unconfigured backend fails closed (503) and only echoes variable names,
 *  - missing/invalid/expired sessions are rejected before any storage call,
 *  - default `entitlement` mode still denies customers without entitlements,
 *  - owner-set `verified_account` mode grants an audited signed URL ONLY
 *    after an authoritative server-side email-confirmation lookup,
 *  - an unconfirmed address is denied and audited as such (never granted),
 *  - a failed confirmation lookup fails closed (no link, retryable error),
 *  - a missing installer release produces a clear 403 (not a fake link),
 *  - a failed audit write fails closed (no unaudited link),
 *  - the payment gates remain disabled,
 *  - the browser client classifies every server answer honestly.
 */

import {assert, assertEqual, test} from './harness.ts';
import {bytesToBase64Url, utf8ToBytes} from '../api/_lib/codec.ts';
import {getCommerceConfig} from '../api/_lib/env.ts';
import {GET as statusGet} from '../api/status.ts';
import {POST as downloadPost} from '../api/download.ts';
import {
  decideVerifiedAccountDownload,
  toDownloadEventResult,
} from '../api/_lib/entitlement.ts';
import {
  classifyDownloadResponse,
  formatFileSize,
  requestInstallerDownload,
  sha256VerificationCommand,
} from '../src/lib/downloadClient.ts';
import {COMMERCE} from '../src/config/commerce.ts';
import {PRICING_APPROVED} from '../src/config/pricing.ts';

const SUPABASE_URL = 'http://127.0.0.1:1';
const JWT_SECRET = 'local-download-test-secret-0123456789';

// A deliberately FAKE key, shaped only so the config loader's format check
// accepts it. Assembled from parts so no key-shaped literal ever appears in
// this file (secret scanners flag prefixed strings even when obviously fake).
const FAKE_SERVICE_ROLE_KEY = ['sb', 'secret', 'local-test-key-0000000000000000'].join('_');

const REQUIRED_ENV: Record<string, string> = {
  SUPABASE_COMMERCE_URL: SUPABASE_URL,
  SUPABASE_COMMERCE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY,
  SUPABASE_AUTH_JWT_SECRET: JWT_SECRET,
  PAYSTACK_SECRET_KEY: 'sk_test_local',
  APP_BASE_URL: 'http://localhost:4173',
};

const RELEASE_ROW = {
  id: '9f0a1111-2222-4333-8444-555566667777',
  version: '1.0.0',
  filename: 'SamTill-POS-Setup.exe',
  storage_path: 'pos/1.0.0/SamTill-POS-Setup.exe',
  sha256: 'C0694FCB7FEED8E21EF18C5D21CEE8392CF683F6671131E258BC3BC3EF97FF07',
  size_bytes: 125267865,
};

// ---------------------------------------------------------------------------
// Environment + fetch helpers (fully restored after every test)
// ---------------------------------------------------------------------------

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const names = new Set([...Object.keys(REQUIRED_ENV), ...Object.keys(overrides)]);
  const saved = [...names].map((name) => [name, process.env[name]] as const);
  for (const name of Object.keys(REQUIRED_ENV)) process.env[name] = REQUIRED_ENV[name];
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

interface RecordedCall {
  url: string;
  method: string;
  body: string | undefined;
}

type StubRouter = (url: string, call: RecordedCall) => Response | undefined;

async function withFetchStub<T>(
  router: StubRouter,
  fn: () => Promise<T>,
): Promise<{value: T; calls: RecordedCall[]}> {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: RecordedCall = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    const response = router(url, call);
    if (response) return response;
    throw new Error(`unexpected network call in test: ${call.method} ${url}`);
  }) as typeof fetch;

  try {
    const value = await fn();
    return {value, calls};
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

/** Emulated commerce backend: PostgREST tables + storage signing + auth admin. */
function backendRouter(options: {
  releases?: unknown[];
  entitlements?: unknown[];
  downloadEventsStatus?: number;
  /**
   * email_confirmed_at returned by the Auth Admin lookup, keyed by user id.
   * Absent user → 404 (mirrors GoTrue), which the handler must treat as a
   * backend error, not as access.
   */
  confirmedUsers?: Record<string, string | null>;
}): StubRouter {
  return (url) => {
    // Auth Admin API: GET /auth/v1/admin/users/{id}
    const authMatch = url.match(/\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/i);
    if (authMatch) {
      const id = authMatch[1];
      const table = options.confirmedUsers ?? {};
      if (!(id in table)) {
        return jsonResponse({msg: 'User not found'}, 404);
      }
      const confirmedAt = table[id];
      return jsonResponse({
        id,
        email: 'buyer@example.com',
        email_confirmed_at: confirmedAt,
      });
    }
    if (url.includes('/rest/v1/installer_releases')) {
      return jsonResponse(options.releases ?? [RELEASE_ROW]);
    }
    if (url.includes('/rest/v1/entitlements')) {
      return jsonResponse(options.entitlements ?? []);
    }
    if (url.includes('/rest/v1/download_events')) {
      return jsonResponse([{id: 'event-1'}], options.downloadEventsStatus ?? 201);
    }
    if (url.includes('/rest/v1/audit_logs')) {
      return jsonResponse([{id: 'audit-1'}], 201);
    }
    if (url.includes('/storage/v1/object/sign/')) {
      return jsonResponse({signedURL: '/object/sign/installers/pos/1.0.0/SamTill-POS-Setup.exe?token=abc'});
    }
    return undefined;
  };
}

async function signSessionToken(sub: string, options: {expired?: boolean} = {}): Promise<string> {
  const header = bytesToBase64Url(utf8ToBytes(JSON.stringify({alg: 'HS256', typ: 'JWT'})));
  const now = Math.floor(Date.now() / 1000);
  const payload = bytesToBase64Url(
    utf8ToBytes(
      JSON.stringify({
        sub,
        role: 'authenticated',
        aud: 'authenticated',
        iss: `${SUPABASE_URL}/auth/v1`,
        exp: options.expired ? now - 600 : now + 3600,
        email: 'buyer@example.com',
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(JWT_SECRET),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, utf8ToBytes(`${header}.${payload}`));
  return `${header}.${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function downloadRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost/api/download', {method: 'POST', headers});
}

let userCounter = 0;
function nextUser(): string {
  userCounter += 1;
  return `00000000-0000-4000-8000-000000000${String(userCounter).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Server handler: fail-closed configuration
// ---------------------------------------------------------------------------

test('download: unconfigured backend fails closed and echoes only variable names', async () => {
  const cleared: Record<string, string | undefined> = {};
  for (const name of Object.keys(REQUIRED_ENV)) cleared[name] = undefined;

  const response = await withEnv(cleared, () => downloadPost(downloadRequest()));
  assertEqual(response.status, 503);
  const body = (await response.json()) as {error: string; missing: string[]};
  assertEqual(body.error, 'commerce_not_configured');
  assert(body.missing.includes('SUPABASE_COMMERCE_URL'), 'reports the missing name');
  assert(!JSON.stringify(body).includes('sb_secret_'), 'never leaks key material');
});

test('download: configuration rejects an unknown DOWNLOAD_ACCESS_MODE', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'everyone_can_have_it'}, async () => {
    const result = getCommerceConfig();
    assertEqual(result.ok, false);
    if (!result.ok) {
      assert(result.invalid.includes('DOWNLOAD_ACCESS_MODE'), 'invalid mode is a config error');
    }
  });

  await withEnv({DOWNLOAD_ACCESS_MODE: undefined}, async () => {
    const result = getCommerceConfig();
    assert(result.ok, 'mode is optional');
    if (result.ok) {
      assertEqual(result.config.downloadAccessMode, 'entitlement', 'default stays entitlement');
    }
  });
});

// ---------------------------------------------------------------------------
// verified_account access policy (pure)
// ---------------------------------------------------------------------------

test('verified_account policy: only a confirmed address is allowed', async () => {
  const allowed = decideVerifiedAccountDownload(true);
  assertEqual(allowed.allowed, true);
  assertEqual(allowed.reason, 'granted');

  const denied = decideVerifiedAccountDownload(false);
  assertEqual(denied.allowed, false);
  assertEqual(denied.reason, 'email_unverified');
  assertEqual(toDownloadEventResult(denied), 'denied_unverified_email');

  // undefined = "could not check" — must never be treated as access.
  const unknown = decideVerifiedAccountDownload(undefined);
  assertEqual(unknown.allowed, false);
  assertEqual(unknown.reason, 'email_unverified');
});

test('verified_account policy: the audit vocabulary covers the new denial', async () => {
  const result = toDownloadEventResult({allowed: false, reason: 'email_unverified'});
  // Must match the CHECK constraint in db/migrations/0001_commerce_init.sql.
  const allowedValues = [
    'granted',
    'denied_no_entitlement',
    'denied_wrong_product',
    'denied_not_yet_active',
    'denied_expired',
    'denied_inactive',
    'denied_no_release',
    'denied_rate_limited',
    'denied_unverified_email',
  ];
  assert(allowedValues.includes(result), `audit value "${result}" is permitted by the schema`);
});

// ---------------------------------------------------------------------------
// Server handler: session requirements
// ---------------------------------------------------------------------------
test('download: a request without a session is rejected before any storage call', async () => {
  await withEnv({}, async () => {
    const {value, calls} = await withFetchStub(backendRouter({}), () => downloadPost(downloadRequest()));
    assertEqual(value.status, 401);
    const body = (await value.json()) as {error: string};
    assertEqual(body.error, 'authentication_required');
    assertEqual(calls.length, 0, 'no backend calls without a session');
  });
});

test('download: an invalid bearer token is rejected without details', async () => {
  await withEnv({}, async () => {
    const {value, calls} = await withFetchStub(backendRouter({}), () =>
      downloadPost(downloadRequest('not-a-jwt')),
    );
    assertEqual(value.status, 401);
    const body = (await value.json()) as {error: string; message: string};
    assertEqual(body.error, 'invalid_session');
    assertEqual(calls.length, 0, 'no backend calls with a bad token');
  });
});

test('download: an expired session token is rejected', async () => {
  await withEnv({}, async () => {
    const token = await signSessionToken(nextUser(), {expired: true});
    const {value, calls} = await withFetchStub(backendRouter({}), () => downloadPost(downloadRequest(token)));
    assertEqual(value.status, 401);
    const body = (await value.json()) as {error: string};
    assertEqual(body.error, 'invalid_session');
    assertEqual(calls.length, 0, 'expired sessions never reach storage');
  });
});

// ---------------------------------------------------------------------------
// Server handler: access modes
// ---------------------------------------------------------------------------

test('download: default entitlement mode denies a customer without entitlements', async () => {
  await withEnv({}, async () => {
    const token = await signSessionToken(nextUser());
    const {value, calls} = await withFetchStub(
      backendRouter({entitlements: [], releases: [RELEASE_ROW]}),
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 403);
    const body = (await value.json()) as {error: string; reason: string; message: string};
    assertEqual(body.error, 'download_denied');
    assertEqual(body.reason, 'no_entitlement');
    assert(body.message.length > 0, 'customer-facing reason provided');
    assert(
      !calls.some((call) => call.url.includes('/storage/v1/object/sign/')),
      'no signed URL issued on denial',
    );
    const audit = calls.find((call) => call.url.includes('/rest/v1/download_events') && call.method === 'POST');
    assert(audit !== undefined, 'denial is audited');
    assert(audit.body !== undefined && audit.body.includes('denied_no_entitlement'), 'audited with the deny reason');
  });
});

test('download: verified_account mode issues an audited signed URL with release metadata', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const user = nextUser();
    const token = await signSessionToken(user);
    const {value, calls} = await withFetchStub(
      backendRouter({releases: [RELEASE_ROW], confirmedUsers: {[user]: '2026-01-01T00:00:00.000Z'}}),
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 200);
    const body = (await value.json()) as {
      url: string;
      expiresAt: string;
      release: {version: string; filename: string; sizeBytes: number; sha256: string};
    };
    assert(body.url.startsWith(`${SUPABASE_URL}/storage/v1/object/sign/`), 'server-issued signed URL');
    assert(Number.isFinite(Date.parse(body.expiresAt)), 'expiry timestamp present');
    assertEqual(body.release.version, '1.0.0');
    assertEqual(body.release.filename, 'SamTill-POS-Setup.exe');
    assertEqual(body.release.sizeBytes, 125267865);
    assertEqual(body.release.sha256, RELEASE_ROW.sha256.toLowerCase(), 'hash exposed for verification');

    assert(
      calls.some((call) => call.url.includes('/auth/v1/admin/users/')),
      'email confirmation is checked authoritatively server-side',
    );
    assert(
      !calls.some((call) => call.url.includes('/rest/v1/entitlements')),
      'entitlements are not consulted in verified_account mode',
    );
    const audit = calls.find((call) => call.url.includes('/rest/v1/download_events') && call.method === 'POST');
    assert(
      audit !== undefined && audit.body !== undefined && audit.body.includes('"granted"'),
      'grant is audited',
    );
  });
});

test('download: verified_account mode denies an UNCONFIRMED address and audits it', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const user = nextUser();
    const token = await signSessionToken(user);
    const {value, calls} = await withFetchStub(
      // Confirmed timestamp is null → the address is not verified.
      backendRouter({releases: [RELEASE_ROW], confirmedUsers: {[user]: null}}),
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 403);
    const body = (await value.json()) as {error: string; message: string; reason?: string};
    assertEqual(body.error, 'download_denied');
    assertEqual(body.reason, 'email_unverified');
    assert(body.message.includes('confirm your email'), 'tells the customer what to do next');
    assert(
      !calls.some((call) => call.url.includes('/storage/v1/object/sign/')),
      'no link is issued to an unverified account',
    );
    const audit = calls.find((call) => call.url.includes('/rest/v1/download_events') && call.method === 'POST');
    assert(
      audit !== undefined && audit.body !== undefined && audit.body.includes('denied_unverified_email'),
      'the refusal is audited with its own reason',
    );
  });
});

test('download: verified_account mode fails closed when the confirmation lookup errors', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const user = nextUser();
    const token = await signSessionToken(user);
    const {value, calls} = await withFetchStub(
      // No confirmedUsers entry → the router answers 404 for this user,
      // which the handler must treat as "could not check", never as access.
      backendRouter({releases: [RELEASE_ROW], confirmedUsers: {}}),
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 502);
    const body = (await value.json()) as {error: string};
    assertEqual(body.error, 'backend_unavailable');
    assert(
      !calls.some((call) => call.url.includes('/storage/v1/object/sign/')),
      'an unverifiable account never receives a link',
    );
  });
});

test('download: entitlement mode does not require an email confirmation lookup', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: undefined}, async () => {
    const user = nextUser();
    const token = await signSessionToken(user);
    const {calls} = await withFetchStub(
      backendRouter({releases: [RELEASE_ROW], entitlements: []}),
      () => downloadPost(downloadRequest(token)),
    );
    assert(
      !calls.some((call) => call.url.includes('/auth/v1/admin/users/')),
      'entitlement mode is unchanged: no auth-admin lookup',
    );
  });
});

test('download: verified_account mode still requires a valid session', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const {value, calls} = await withFetchStub(backendRouter({}), () => downloadPost(downloadRequest()));
    assertEqual(value.status, 401);
    assertEqual(calls.length, 0, 'mode does not bypass authentication');
  });
});

test('download: a missing active release returns a clear "not available" error', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const user = nextUser();
    const token = await signSessionToken(user);
    const {value, calls} = await withFetchStub(
      backendRouter({releases: [], confirmedUsers: {[user]: '2026-01-01T00:00:00.000Z'}}),
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 403);
    const body = (await value.json()) as {error: string; message: string};
    assertEqual(body.error, 'download_unavailable');
    assert(body.message.includes('not available'), 'explains the missing installer');
    assert(
      !calls.some((call) => call.url.includes('/storage/v1/object/sign/')),
      'no link is invented when the installer is missing',
    );
  });
});

test('download: fails closed when the audit row cannot be written', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const user = nextUser();
    const token = await signSessionToken(user);
    const {value} = await withFetchStub(
      backendRouter({
        releases: [RELEASE_ROW],
        confirmedUsers: {[user]: '2026-01-01T00:00:00.000Z'},
        downloadEventsStatus: 500,
      }),
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 503);
    const body = (await value.json()) as {error: string};
    assertEqual(body.error, 'audit_unavailable');
    assert(!('url' in body), 'no unaudited link is handed out');
  });
});

test('download: an unreachable backend surfaces as 502, not a crash', async () => {
  await withEnv({DOWNLOAD_ACCESS_MODE: 'verified_account'}, async () => {
    const token = await signSessionToken(nextUser());
    const {value} = await withFetchStub(
      () => {
        throw new Error('ECONNREFUSED (stubbed)');
      },
      () => downloadPost(downloadRequest(token)),
    );
    assertEqual(value.status, 502);
    const body = (await value.json()) as {error: string};
    assertEqual(body.error, 'backend_unavailable');
  });
});

// ---------------------------------------------------------------------------
// Payment gates stay off
// ---------------------------------------------------------------------------

test('status: payment gates are reported disabled and the download mode is visible', async () => {
  await withEnv({}, async () => {
    const response = statusGet(new Request('http://localhost/api/status', {method: 'GET'}));
    assertEqual(response.status, 200);
    const body = (await response.json()) as {
      flags: {checkoutEnabled: boolean; publishPrices: boolean; allowLivePayments: boolean};
      downloadAccessMode: string;
      backendConfigured: boolean;
    };
    assertEqual(body.flags.checkoutEnabled, false, 'CHECKOUT_ENABLED unset');
    assertEqual(body.flags.publishPrices, false, 'PUBLISH_PRICES unset');
    assertEqual(body.flags.allowLivePayments, false, 'ALLOW_LIVE_PAYMENTS unset');
    assertEqual(body.downloadAccessMode, 'entitlement');
    assertEqual(body.backendConfigured, true);
  });
});

test('commerce config: pricing is approved while the payment display gate is still off', () => {
  // Phase 0: the one-time tiers (499/899/1499) are approved, so the site no
  // longer shows draft pricing. The payment switch stays off until the
  // commerce backend is provisioned — buying still requires a Buy button,
  // which only appears when the server publishes the matching plan.
  assertEqual(PRICING_APPROVED, true, 'PRICING_APPROVED is true');
  assertEqual(COMMERCE.paymentsEnabled, false, 'paymentsEnabled ships false');
});

// ---------------------------------------------------------------------------
// Browser-side classification
// ---------------------------------------------------------------------------

test('client: a granted response is parsed with full release metadata', async () => {
  const granted = classifyDownloadResponse(200, {
    url: 'https://storage.example/object/sign/x?token=y',
    expiresAt: '2026-10-28T12:00:00.000Z',
    release: {version: '1.0.0', filename: 'SamTill-POS-Setup.exe', sizeBytes: 125267865, sha256: 'a'.repeat(64)},
  });
  assert(granted.ok, 'grant parses');
  if (granted.ok) assertEqual(granted.release.filename, 'SamTill-POS-Setup.exe');
});

test('client: a malformed 200 body never becomes a fake download', () => {
  const malformed = classifyDownloadResponse(200, {url: 'https://x'});
  assert(!malformed.ok, 'incomplete grant rejected');
  if (!malformed.ok) assertEqual(malformed.kind, 'invalid_response');

  const empty = classifyDownloadResponse(200, null);
  assert(!empty.ok, 'empty body rejected');
});

test('client: authentication and session failures ask the customer to sign in', () => {
  const anonymous = classifyDownloadResponse(401, {error: 'authentication_required'});
  assert(!anonymous.ok && anonymous.kind === 'auth_required');

  const expired = classifyDownloadResponse(401, {error: 'invalid_session'});
  assert(!expired.ok && expired.kind === 'session_expired', 'expired session is distinct');
});

test('client: access decisions from the server are shown with their reason', () => {
  const denied = classifyDownloadResponse(403, {
    error: 'download_denied',
    message: 'Your account does not include installer downloads yet.',
    reason: 'expired',
    validTo: '2026-10-01T00:00:00.000Z',
  });
  assert(!denied.ok && denied.kind === 'access_denied');
  if (!denied.ok) {
    assertEqual(denied.reason, 'expired');
    assert(denied.message.includes('does not include'), 'server message surfaced');
  }

  const missing = classifyDownloadResponse(403, {error: 'download_unavailable'});
  assert(!missing.ok && missing.kind === 'installer_unavailable');
});

test('client: rate limits, missing API and unconfigured backend are distinguishable', () => {
  const limited = classifyDownloadResponse(429, {error: 'rate_limited'}, 120);
  assert(!limited.ok && limited.kind === 'rate_limited' && limited.retryable && limited.retryAfterSeconds === 120);

  const missing = classifyDownloadResponse(404, null);
  assert(!missing.ok && missing.kind === 'api_missing');

  const unconfigured = classifyDownloadResponse(503, {error: 'commerce_not_configured'});
  assert(!unconfigured.ok && unconfigured.kind === 'not_configured' && !unconfigured.retryable);

  const busy = classifyDownloadResponse(502, {error: 'backend_unavailable'});
  assert(!busy.ok && busy.kind === 'backend_unavailable' && busy.retryable);
});

test('client: a network failure while requesting the link is handled safely', async () => {
  const offline = requestInstallerDownload({
    accessToken: 'token',
    fetchImpl: (async () => {
      throw new Error('failed to fetch');
    }) as typeof fetch,
  });
  const result = await offline;
  assert(!result.ok && result.kind === 'network' && result.retryable);
});

test('client: the bearer token is sent to the API and a grant parses end-to-end', async () => {
  let seenAuth: string | null = null;
  const result = await requestInstallerDownload({
    accessToken: 'customer-access-token',
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      assert(url.endsWith('/api/download'), 'hits the download endpoint');
      const headers = new Headers(init?.headers);
      seenAuth = headers.get('authorization');
      return jsonResponse({
        url: 'https://storage.example/object/sign/x?token=y',
        expiresAt: '2026-10-28T12:00:00.000Z',
        release: {version: '1.0.0', filename: 'SamTill-POS-Setup.exe', sizeBytes: 125267865, sha256: 'a'.repeat(64)},
      });
    }) as typeof fetch,
  });
  assert(result.ok, 'grant parses');
  assertEqual(seenAuth, 'Bearer customer-access-token');
});

test('client: file size and SHA-256 verification helpers render usefully', () => {
  assertEqual(formatFileSize(125267865), '119.5 MB');
  assertEqual(formatFileSize(0), 'unknown size');
  const command = sha256VerificationCommand('SamTill-POS-Setup.exe');
  assert(command.includes('Get-FileHash'), 'offers a real verification command');
  assert(command.includes('SamTill-POS-Setup.exe'), 'references the actual file');
});
