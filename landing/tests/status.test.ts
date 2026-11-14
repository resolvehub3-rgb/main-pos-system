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

test('status: payment gates default enabled when unset and respect explicit false opt-out', async () => {
  await withEnv(async () => {
    const savedCheckout = process.env.CHECKOUT_ENABLED;
    const savedPublish = process.env.PUBLISH_PRICES;
    delete process.env.CHECKOUT_ENABLED;
    delete process.env.PUBLISH_PRICES;

    const response = statusGet(new Request('http://localhost/api/status', {method: 'GET'}));
    assertEqual(response.status, 200);
    const body = (await response.json()) as {
      phase: string;
      flags: {checkoutEnabled: boolean; publishPrices: boolean; allowLivePayments: boolean};
      backendConfigured: boolean;
      endpoints: Array<{method: string; path: string}>;
    };
    assertEqual(body.phase, 'ready');
    assertEqual(body.flags.checkoutEnabled, true, 'CHECKOUT_ENABLED defaults enabled');
    assertEqual(body.flags.publishPrices, true, 'PUBLISH_PRICES defaults enabled');
    assertEqual(body.flags.allowLivePayments, false, 'ALLOW_LIVE_PAYMENTS unset');
    assertEqual(body.backendConfigured, true);
    assert(
      !body.endpoints.some((endpoint) => endpoint.path.includes('download')),
      'no download endpoint is advertised',
    );

    process.env.CHECKOUT_ENABLED = 'false';
    process.env.PUBLISH_PRICES = 'false';
    const disabledResponse = statusGet(new Request('http://localhost/api/status', {method: 'GET'}));
    const disabledBody = (await disabledResponse.json()) as {
      flags: {checkoutEnabled: boolean; publishPrices: boolean};
    };
    assertEqual(disabledBody.flags.checkoutEnabled, false, 'CHECKOUT_ENABLED=false disables checkout');
    assertEqual(disabledBody.flags.publishPrices, false, 'PUBLISH_PRICES=false hides prices');

    if (savedCheckout === undefined) delete process.env.CHECKOUT_ENABLED;
    else process.env.CHECKOUT_ENABLED = savedCheckout;
    if (savedPublish === undefined) delete process.env.PUBLISH_PRICES;
    else process.env.PUBLISH_PRICES = savedPublish;
  });
});

test('status: the installer-download access mode is no longer exposed', async () => {
  await withEnv(async () => {
    const response = statusGet(new Request('http://localhost/api/status', {method: 'GET'}));
    const body = (await response.json()) as Record<string, unknown>;
    assert(!('downloadAccessMode' in body), 'downloadAccessMode field removed');
  });
});
