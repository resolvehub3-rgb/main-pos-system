/**
 * GET /api/status tests — checks unified & standalone env config, default
 * enabled flags for checkout/pricing, and explicit disable flags.
 */

import {assert, assertEqual, test} from './harness.ts';
import {GET as statusGet} from '../api/status.ts';

const SUPABASE_URL = 'http://127.0.0.1:1';
const FAKE_SERVICE_ROLE_KEY = ['sb', 'secret', 'local-test-key-0000000000000000'].join('_');

async function withCustomEnv<T>(envPatch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const keys = Array.from(
    new Set([
      ...Object.keys(envPatch),
      'SUPABASE_COMMERCE_URL',
      'SUPABASE_COMMERCE_SERVICE_ROLE_KEY',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'PAYSTACK_SECRET_KEY',
      'APP_BASE_URL',
      'CHECKOUT_ENABLED',
      'PUBLISH_PRICES',
      'ALLOW_LIVE_PAYMENTS',
    ]),
  );
  const saved = keys.map((name) => [name, process.env[name]] as const);
  for (const key of keys) {
    if (key in envPatch) {
      const value = envPatch[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    } else {
      delete process.env[key];
    }
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

test('status: unified Supabase env + Paystack key configures backend with active defaults', async () => {
  await withCustomEnv(
    {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY,
      PAYSTACK_SECRET_KEY: 'sk_test_local',
    },
    async () => {
      const response = statusGet(new Request('http://localhost:3000/api/status', {method: 'GET'}));
      assertEqual(response.status, 200);
      const body = (await response.json()) as {
        flags: {checkoutEnabled: boolean; publishPrices: boolean; allowLivePayments: boolean};
        backendConfigured: boolean;
        databaseConfigured: boolean;
        endpoints: Array<{method: string; path: string}>;
      };
      assertEqual(body.flags.checkoutEnabled, true, 'CHECKOUT_ENABLED defaults true');
      assertEqual(body.flags.publishPrices, true, 'PUBLISH_PRICES defaults true');
      assertEqual(body.flags.allowLivePayments, false, 'ALLOW_LIVE_PAYMENTS defaults false');
      assertEqual(body.backendConfigured, true);
      assertEqual(body.databaseConfigured, true);
      assert(body.endpoints.some((endpoint) => endpoint.path === '/api/contact'), 'contact endpoint advertised');
    },
  );
});

test('status: database can be configured without Paystack secret and explicit disable flags are respected', async () => {
  await withCustomEnv(
    {
      SUPABASE_COMMERCE_URL: SUPABASE_URL,
      SUPABASE_COMMERCE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY,
      CHECKOUT_ENABLED: 'false',
      PUBLISH_PRICES: 'false',
    },
    async () => {
      const response = statusGet(new Request('http://localhost:3000/api/status', {method: 'GET'}));
      const body = (await response.json()) as {
        flags: {checkoutEnabled: boolean; publishPrices: boolean};
        backendConfigured: boolean;
        databaseConfigured: boolean;
        missing: string[];
      };
      assertEqual(body.databaseConfigured, true);
      assertEqual(body.backendConfigured, false);
      assert(body.missing.includes('PAYSTACK_SECRET_KEY'), 'missing Paystack key reported');
      assertEqual(body.flags.checkoutEnabled, false);
      assertEqual(body.flags.publishPrices, false);
      assert(!('downloadAccessMode' in body), 'downloadAccessMode field removed');
    },
  );
});
