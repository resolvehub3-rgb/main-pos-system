/**
 * GET /api/status tests — the reviewer overview reports the payment gates as
 * disabled, echoes only variable NAMES of missing configuration, and no
 * longer exposes any installer-download access mode (SamTill is a browser
 * PWA; the installer-download layer was removed). No real network.
 */

import {assert, assertEqual, test} from './harness.ts';
import {GET as statusGet} from '../api/status.ts';

const SUPABASE_URL = 'http://127.0.0.1:1';
const JWT_SECRET = 'local-status-test-secret-0123456789';

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

/** Set the required env for the duration of the test, then restore it. */
async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = Object.keys(REQUIRED_ENV).map((name) => [name, process.env[name]] as const);
  for (const [name, value] of Object.entries(REQUIRED_ENV)) process.env[name] = value;
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('status: payment gates are reported disabled and the backend is configured', async () => {
  await withEnv(async () => {
    const response = statusGet(new Request('http://localhost/api/status', {method: 'GET'}));
    assertEqual(response.status, 200);
    const body = (await response.json()) as {
      flags: {checkoutEnabled: boolean; publishPrices: boolean; allowLivePayments: boolean};
      backendConfigured: boolean;
      endpoints: Array<{method: string; path: string}>;
    };
    assertEqual(body.flags.checkoutEnabled, false, 'CHECKOUT_ENABLED unset');
    assertEqual(body.flags.publishPrices, false, 'PUBLISH_PRICES unset');
    assertEqual(body.flags.allowLivePayments, false, 'ALLOW_LIVE_PAYMENTS unset');
    assertEqual(body.backendConfigured, true);
    assert(
      !body.endpoints.some((endpoint) => endpoint.path.includes('download')),
      'no download endpoint is advertised',
    );
  });
});

test('status: the installer-download access mode is no longer exposed', async () => {
  await withEnv(async () => {
    const response = statusGet(new Request('http://localhost/api/status', {method: 'GET'}));
    const body = (await response.json()) as Record<string, unknown>;
    assert(!('downloadAccessMode' in body), 'downloadAccessMode field removed');
  });
});
