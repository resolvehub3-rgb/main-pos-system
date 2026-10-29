/**
 * Checkout flow tests — plan publication, checkout start, payment
 * verification and licence display. No real network: `fetch` is stubbed per
 * test, and the backoff test injects a no-op sleep so the suite stays fast.
 *
 * Covered journeys:
 *  - GET /api/plans: published prices parse, draft/unconfigured answers fail
 *    closed and a malformed body never becomes a fake price,
 *  - POST /api/checkout: a valid answer yields the hosted URL and the
 *    SERVER's plan; every refusal (disabled, unconfigured, unknown plan,
 *    client price, rate limit, provider down) is classified honestly,
 *  - POST /api/verify: paid / pending / mismatch / needs-review / rate-limit
 *    / unconfigured answers are distinguished, and no failure is ever
 *    reported as success,
 *  - verifyWithBackoff: retries only while the server says retrying helps,
 *    stops dead on a definitive answer, and never converts a failure into a
 *    success,
 *  - the request builders send only `{planCode}` / `{reference}` with the
 *    bearer token and no price fields,
 *  - GET /api/subscription parses the licence state shown on the account page,
 *  - the checkout availability gate needs payments + accounts + configuration,
 *  - routing: `#/checkout` is an account route, Paystack's return query
 *    survives parsing, and `next=checkout` is an allowed destination,
 *  - approved commercial copy: one-time tiers, no draft/"to be confirmed"
 *    text left in the source the site renders.
 */

import {readFileSync} from 'node:fs';
import {assert, assertEqual, test} from './harness.ts';
import {
  classifyAccessResponse,
  classifyCheckoutResponse,
  classifyPlansResponse,
  classifyVerifyResponse,
  checkoutFailureMessage,
  fetchMyAccess,
  fetchPublishedPlans,
  formatMinorAmount,
  startCheckout,
  verifyPayment,
  verifyWithBackoff,
} from '../src/lib/checkoutClient.ts';
import {checkoutAvailability} from '../src/lib/availability.ts';
import {
  ACCOUNT_ROUTES,
  isAccountRoute,
  nextRouteAfterSignIn,
  parseRoute,
} from '../src/lib/hashRoute.ts';
import {COMPARISON_ROWS, LICENCE_TERMS, PACKAGES, PRICING_APPROVED} from '../src/config/pricing.ts';
import {COMMERCE} from '../src/config/commerce.ts';

const API = 'https://api.example.com';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', ...headers},
  });
}

const PLAN_ROW = {
  code: 'starter',
  name: 'Starter',
  amountMinor: 49900,
  currency: 'GHS',
  intervalMonths: 6,
};

const ENTITLEMENT = {
  productCode: 'samtill-pos',
  status: 'active',
  validFrom: '2026-10-28T10:00:00.000Z',
  validTo: '2027-04-28T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// GET /api/plans
// ---------------------------------------------------------------------------

test('plans: a published price list parses with server amounts only', () => {
  const result = classifyPlansResponse(200, {plans: [PLAN_ROW]});
  assert(result.ok, 'published list succeeds');
  if (result.ok) {
    assertEqual(result.plans.length, 1);
    assertEqual(result.plans[0].amountMinor, 49900, 'server amount survives');
    assertEqual(result.plans[0].intervalMonths, 6);
  }
});

test('plans: a malformed 200 body never becomes a price', () => {
  const missingField = classifyPlansResponse(200, {
    plans: [{code: 'starter', name: 'Starter', amountMinor: 'free', currency: 'GHS', intervalMonths: 6}],
  });
  assert(!missingField.ok && missingField.kind === 'invalid_response', 'non-numeric amount rejected');

  const notAnArray = classifyPlansResponse(200, {plans: 'nope'});
  assert(!notAnArray.ok && notAnArray.kind === 'invalid_response', 'non-array rejected');
  assert(notAnArray.retryable, 'a broken answer can be retried');
});

test('plans: draft pricing is refused as "not published", not as an error', () => {
  const result = classifyPlansResponse(403, {error: 'pricing_not_approved', message: 'Prices are not published yet.'});
  assert(!result.ok && result.kind === 'pricing_not_published', '403 → pricing_not_published');
  assert(!result.retryable, 'waiting will not publish prices');
  assert(result.message.includes('not published'), 'honest message kept');
});

test('plans: an unconfigured backend fails closed without pretending', () => {
  const result = classifyPlansResponse(503, {error: 'commerce_not_configured', message: 'The commerce backend is not configured yet.'});
  assert(!result.ok && result.kind === 'not_configured', '503 commerce_not_configured → not_configured');
  assert(!result.retryable);

  const other503 = classifyPlansResponse(503, {error: 'other'});
  assert(!other503.ok && other503.kind === 'backend_unavailable');
});

test('plans: a 502 is retryable and a network failure is reported as such', async () => {
  const serverDown = classifyPlansResponse(502, {});
  assert(!serverDown.ok && serverDown.retryable, '502 → retryable');

  const result = await fetchPublishedPlans({
    apiBase: 'https://api.example.com/',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED (stubbed)');
    },
  });
  assert(!result.ok && result.kind === 'network', 'network failure classified');
  assert(result.retryable, 'network failure is retryable');
});

test('plans: the request URL joins the API base without double slashes', async () => {
  let seen = '';
  await fetchPublishedPlans({
    apiBase: 'https://api.example.com///',
    fetchImpl: async (input) => {
      seen = String(input);
      return jsonResponse(200, {plans: []});
    },
  });
  assertEqual(seen, 'https://api.example.com/api/plans');
});

// ---------------------------------------------------------------------------
// POST /api/checkout
// ---------------------------------------------------------------------------

test('checkout: a valid answer returns the hosted URL and the server plan', () => {
  const result = classifyCheckoutResponse(200, {
    reference: 'st_abcdef0123456789',
    authorizationUrl: 'https://checkout.paystack.com/abc',
    plan: PLAN_ROW,
  });
  assert(result.ok, 'checkout starts');
  if (result.ok) {
    assertEqual(result.reference, 'st_abcdef0123456789');
    assertEqual(result.authorizationUrl, 'https://checkout.paystack.com/abc');
    assertEqual(result.plan.amountMinor, 49900, 'price came from the server');
  }
});

test('checkout: a 200 without a reference or plan never redirects anywhere', () => {
  const noPlan = classifyCheckoutResponse(200, {reference: 'st_x', authorizationUrl: 'https://checkout.paystack.com/a'});
  assert(!noPlan.ok && noPlan.kind === 'invalid_response', 'missing plan rejected');

  const noUrl = classifyCheckoutResponse(200, {reference: 'st_x', plan: PLAN_ROW});
  assert(!noUrl.ok && noUrl.kind === 'invalid_response', 'missing authorization URL rejected');
});

test('checkout: disabled checkout and an unconfigured backend are distinguishable', () => {
  const disabled = classifyCheckoutResponse(503, {
    error: 'checkout_disabled',
    message: 'Online checkout is not available yet. Please enquire to purchase.',
  });
  assert(!disabled.ok && disabled.kind === 'checkout_disabled');
  assert(!disabled.retryable, 'checkout_disabled does not go away by retrying');

  const unconfigured = classifyCheckoutResponse(503, {error: 'commerce_not_configured'});
  assert(!unconfigured.ok && unconfigured.kind === 'not_configured');
});

test('checkout: every plan refusal keeps its own meaning', () => {
  const cases: [number, string, string][] = [
    [400, 'plan_not_found', 'plan_not_found'],
    [400, 'plan_required', 'plan_unavailable'],
    [400, 'plan_inactive', 'plan_unavailable'],
    [400, 'client_price_not_allowed', 'rejected_client_price'],
    [400, 'email_required', 'email_required'],
  ];
  for (const [status, code, expected] of cases) {
    const result = classifyCheckoutResponse(status, {error: code, message: 'x'});
    assert(!result.ok, `${code} fails`);
    assertEqual(result.kind, expected, `${code} → ${expected}`);
    assert(!result.retryable, `${code} is not retryable`);
  }
});

test('checkout: session failures ask for sign-in, rate limits say how long', () => {
  const expired = classifyCheckoutResponse(401, {error: 'invalid_session', message: 'Your session has expired.'});
  assert(!expired.ok && expired.kind === 'session_expired');

  const anonymous = classifyCheckoutResponse(401, {error: 'authentication_required'});
  assert(!anonymous.ok && anonymous.kind === 'auth_required');

  const limited = classifyCheckoutResponse(429, {error: 'rate_limited', message: 'Too many requests.'}, 45);
  assert(!limited.ok && limited.kind === 'rate_limited');
  assert(limited.retryable, 'rate limits are temporary');
  assertEqual(limited.retryAfterSeconds, 45, 'server retry-after is preserved');
});

test('checkout: a provider outage is retryable, the generic fallback too', () => {
  const provider = classifyCheckoutResponse(502, {error: 'paystack_unavailable', message: 'The payment provider is unavailable.'});
  assert(!provider.ok && provider.kind === 'paystack_unavailable' && provider.retryable);

  const generic = classifyCheckoutResponse(502, {error: 'checkout_failed'});
  assert(!generic.ok && generic.kind === 'backend_unavailable' && generic.retryable);
});

test('checkout: the request carries a plan code and NO price field', async () => {
  let captured: {url: string; auth: string | null; body: unknown} | null = null;

  const result = await startCheckout({
    apiBase: API,
    accessToken: 'token-abc',
    planCode: 'starter',
    fetchImpl: async (input, init) => {
      captured = {
        url: String(input),
        auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      return jsonResponse(200, {
        reference: 'st_abcdef0123456789',
        authorizationUrl: 'https://checkout.paystack.com/abc',
        plan: PLAN_ROW,
      });
    },
  });

  assert(result.ok, 'checkout resolves');
  assert(captured, 'the request was observed');
  const observed = captured as {url: string; auth: string | null; body: unknown};
  assertEqual(observed.url, 'https://api.example.com/api/checkout');
  assertEqual(observed.auth, 'Bearer token-abc', 'session token is sent');
  assertEqual(observed.body, {planCode: 'starter'}, 'only the plan code is sent — never a price');
});

test('checkout: a thrown network error becomes a safe result, not a crash', async () => {
  const result = await startCheckout({
    apiBase: '',
    accessToken: 't',
    planCode: 'starter',
    fetchImpl: async () => {
      throw new Error('network down (stubbed)');
    },
  });
  assert(!result.ok && result.kind === 'network', 'network failure classified');
  assert(result.retryable);
});

// ---------------------------------------------------------------------------
// POST /api/verify
// ---------------------------------------------------------------------------

test('verify: a paid answer parses with its entitlement', () => {
  const result = classifyVerifyResponse(200, {
    status: 'paid',
    reference: 'st_abcdef0123456789',
    outcome: 'applied',
    entitlement: ENTITLEMENT,
  });
  assert(result.ok, 'paid parses');
  if (result.ok) {
    assertEqual(result.status, 'paid');
    assertEqual(result.outcome, 'applied');
    assertEqual(result.entitlement?.validTo, ENTITLEMENT.validTo);
  }
});

test('verify: a 200 that is not "paid" is never shown as success', () => {
  const result = classifyVerifyResponse(200, {status: 'pending', reference: 'st_x'});
  assert(!result.ok && result.kind === 'invalid_response', 'unexpected status rejected');
  assert(result.retryable, 'can be re-checked');
});

test('verify: pending payments are reported as pending, not failed', () => {
  const result = classifyVerifyResponse(402, {
    error: 'payment_not_successful',
    message: 'Payment status is "pending".',
  });
  assert(!result.ok && result.kind === 'payment_pending');
  assert(!result.retryable, 'the customer decides when to check again');
  assert(result.message.includes('pending'), 'provider status shown honestly');
});

test('verify: not-found, invalid reference and review cases stay distinct', () => {
  const notFound = classifyVerifyResponse(404, {error: 'order_not_found', message: 'No payment found for that reference.'});
  assert(!notFound.ok && notFound.kind === 'order_not_found' && !notFound.retryable);

  const invalid = classifyVerifyResponse(400, {error: 'invalid_reference'});
  assert(!invalid.ok && invalid.kind === 'reference_invalid');

  const review = classifyVerifyResponse(409, {
    error: 'payment_recording_needs_review',
    message: 'Payment confirmed but recording needs review.',
  });
  assert(!review.ok && review.kind === 'needs_review' && !review.retryable);
  assert(review.message.includes('review'), 'customer is told what happens next');

  const amount = classifyVerifyResponse(409, {error: 'amount_mismatch'});
  assert(!amount.ok && amount.kind === 'amount_mismatch');
});

test('verify: session, rate limit, unconfigured and transient failures', () => {
  const expired = classifyVerifyResponse(401, {error: 'invalid_session'});
  assert(!expired.ok && expired.kind === 'session_expired');

  const limited = classifyVerifyResponse(429, {error: 'rate_limited'}, 30);
  assert(!limited.ok && limited.kind === 'rate_limited' && limited.retryable);
  assertEqual(limited.retryAfterSeconds, 30);

  const unconfigured = classifyVerifyResponse(503, {error: 'commerce_not_configured'});
  assert(!unconfigured.ok && unconfigured.kind === 'not_configured' && !unconfigured.retryable);

  const transient = classifyVerifyResponse(502, {error: 'recording_in_progress', message: 'The payment is still being recorded.'});
  assert(!transient.ok && transient.kind === 'retryable' && transient.retryable);
});

test('verify: a network failure is retryable and keeps the reference', async () => {
  const result = await verifyPayment({
    apiBase: '',
    accessToken: 't',
    reference: 'st_abcdef0123456789',
    fetchImpl: async () => {
      throw new Error('offline (stubbed)');
    },
  });
  assert(!result.ok && result.kind === 'network');
  assert(result.retryable);
  assertEqual(result.reference, 'st_abcdef0123456789', 'reference survives for a later retry');
});

// ---------------------------------------------------------------------------
// verifyWithBackoff
// ---------------------------------------------------------------------------

test('backoff: retries while the server is still recording, then succeeds', async () => {
  let calls = 0;
  const slept: number[] = [];

  const result = await verifyWithBackoff({
    apiBase: '',
    accessToken: 't',
    reference: 'st_abcdef0123456789',
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse(502, {error: 'recording_in_progress', message: 'still being recorded'});
      }
      return jsonResponse(200, {status: 'paid', reference: 'st_abcdef0123456789', outcome: 'applied', entitlement: ENTITLEMENT});
    },
  });

  assert(result.ok, 'eventually confirmed');
  assertEqual(calls, 3, 'two failures then success');
  assertEqual(slept, [1500, 3000], 'first attempt is immediate, gaps grow');
});

test('backoff: stops immediately on a definitive answer and never upgrades it', async () => {
  let calls = 0;
  const slept: number[] = [];

  const result = await verifyWithBackoff({
    apiBase: '',
    accessToken: 't',
    reference: 'st_abcdef0123456789',
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(402, {error: 'payment_not_successful', message: 'Payment status is "abandoned".'});
    },
  });

  assert(!result.ok, 'a failed payment stays failed');
  assert(result.kind === 'payment_pending', 'classified as pending/abandoned');
  assertEqual(calls, 1, 'no pointless retries on a final answer');
  assertEqual(slept, [], 'no waiting after a final answer');
});

test('backoff: gives up after the scheduled attempts when the network is down', async () => {
  let calls = 0;
  const slept: number[] = [];

  const result = await verifyWithBackoff({
    apiBase: '',
    accessToken: 't',
    reference: 'st_abcdef0123456789',
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error('offline (stubbed)');
    },
  });

  assert(!result.ok && result.retryable, 'honest failure after the last attempt');
  assertEqual(calls, 4, 'one attempt per scheduled slot');
  assertEqual(slept.length, 3, 'three waits between four attempts');
});

// ---------------------------------------------------------------------------
// GET /api/subscription (licence display)
// ---------------------------------------------------------------------------

test('access: entitlements parse for the account page', () => {
  const result = classifyAccessResponse(200, {
    subscription: null,
    entitlements: [{...ENTITLEMENT, planCode: 'starter'}],
  });
  assert(result.ok, 'licence list parses');
  if (result.ok) {
    assertEqual(result.entitlements.length, 1);
    assertEqual(result.entitlements[0].planCode, 'starter');
  }

  const empty = classifyAccessResponse(200, {subscription: null, entitlements: []});
  assert(empty.ok && empty.ok && empty.entitlements.length === 0, 'no licence yet is a valid answer');

  const junk = classifyAccessResponse(200, {entitlements: 'nope'});
  assert(!junk.ok && junk.kind === 'invalid_response', 'malformed body rejected');
});

test('access: session and configuration failures are not shown as "no licence"', () => {
  const expired = classifyAccessResponse(401, {error: 'invalid_session'});
  assert(!expired.ok && expired.kind === 'session_expired');

  const unconfigured = classifyAccessResponse(503, {error: 'commerce_not_configured'});
  assert(!unconfigured.ok && unconfigured.kind === 'not_configured');
});

test('access: the request is authenticated and cache-free', async () => {
  let auth: string | null = null;
  await fetchMyAccess({
    apiBase: '',
    accessToken: 'token-xyz',
    fetchImpl: async (input, init) => {
      assert(String(input).endsWith('/api/subscription'), 'hits the access endpoint');
      auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
      return jsonResponse(200, {subscription: null, entitlements: []});
    },
  });
  assertEqual(auth, 'Bearer token-xyz', 'bearer token sent');
});

// ---------------------------------------------------------------------------
// Availability gates
// ---------------------------------------------------------------------------

const configured = {supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_x'};
const open = {accountEnabled: true, paymentsEnabled: true};

test('gates: checkout needs payments, accounts and configuration', () => {
  const off = checkoutAvailability({accountEnabled: true, paymentsEnabled: false}, configured);
  assert(!off.available && off.reason === 'disabled');
  assert(off.notice.includes('not open yet'), 'honest not-yet notice');

  const noAccounts = checkoutAvailability({accountEnabled: false, paymentsEnabled: true}, configured);
  assert(!noAccounts.available, 'no accounts ⇒ no checkout');
  assert(noAccounts.notice.includes('account'), 'tells the customer to create one first');

  const unconfigured = checkoutAvailability(open, {});
  assert(!unconfigured.available && unconfigured.reason === 'not_configured');

  const ready = checkoutAvailability(open, configured);
  assert(ready.available && ready.reason === 'available');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('routing: checkout is an account route with an allowed sign-in destination', () => {
  assert(isAccountRoute('/checkout'), 'checkout recognised');
  assert((ACCOUNT_ROUTES as readonly string[]).includes('/checkout'));
  assertEqual(nextRouteAfterSignIn(new URLSearchParams('next=checkout')), '/checkout');
  assertEqual(nextRouteAfterSignIn(new URLSearchParams('next=nonsense')), '/account', 'unknown next is ignored');
});

test('routing: Paystack return parameters survive query parsing', () => {
  const route = parseRoute('', '?checkout=return&reference=st_abcdef0123456789');
  assertEqual(route.path, '/');
  assertEqual(route.params.get('checkout'), 'return');
  assertEqual(route.params.get('reference'), 'st_abcdef0123456789');

  // The hash route App.tsx navigates to keeps the reference too.
  const checkoutRoute = parseRoute('#/checkout?reference=st_abcdef0123456789', '');
  assertEqual(checkoutRoute.path, '/checkout');
  assertEqual(checkoutRoute.params.get('reference'), 'st_abcdef0123456789');
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

test('display: minor units format as GHS without stray decimals', () => {
  assertEqual(formatMinorAmount(49900, 'GHS'), 'GH₵499');
  assertEqual(formatMinorAmount(89900, 'GHS'), 'GH₵899');
  assertEqual(formatMinorAmount(149900, 'GHS'), 'GH₵1,499');
  assertEqual(formatMinorAmount(49950, 'GHS'), 'GH₵499.50');
  assertEqual(formatMinorAmount(10000, 'NGN'), '₦100', 'unknown-but-known currency symbol');
});

test('display: every checkout failure kind has a customer-readable message', () => {
  const kinds = [
    'checkout_disabled',
    'paystack_unavailable',
    'rate_limited',
    'network',
    'backend_unavailable',
  ] as const;
  for (const kind of kinds) {
    const message = checkoutFailureMessage(kind);
    assert(message.length > 10 && !message.includes('undefined'), `${kind} has a real message`);
  }
});

// ---------------------------------------------------------------------------
// Approved commercial copy (Phase 0)
// ---------------------------------------------------------------------------

test('commercial: pricing is approved and the one-time tiers are the ones on file', () => {
  assertEqual(PRICING_APPROVED, true, 'PRICING_APPROVED is true');
  assertEqual(
    PACKAGES.map((pkg) => pkg.price),
    [499, 899, 1499],
    'approved prices',
  );
  assert(PACKAGES.every((pkg) => pkg.licenceType === 'One-time licence'), 'one-time only');
  assert(PACKAGES.every((pkg) => pkg.licenceSeats === '1 computer'), 'one computer each');
  assert(PACKAGES.every((pkg) => !pkg.draftTierFeatures), 'no draft feature notices');
  assertEqual(new Set(PACKAGES.map((pkg) => pkg.id)).size, PACKAGES.length, 'package ids unique (they are plan codes)');
});

test('commercial: no "to be confirmed" rows remain in the comparison table', () => {
  assertEqual(COMPARISON_ROWS.length > 0, true, 'comparison rows exist');
  assert(COMPARISON_ROWS.every((row) => !row.ownerReview), 'every row is confirmed');
  assert(
    COMPARISON_ROWS.every((row) => row.values.every((value) => !value.includes('To be confirmed'))),
    'no placeholder values',
  );
});

test('commercial: licence terms no longer promise that terms are coming', () => {
  assert(!LICENCE_TERMS.renewalNote.includes('finalised'), 'renewal note is final');
  assert(!LICENCE_TERMS.renewalNote.includes('before launch'), 'no "before launch" wording');
  assert(LICENCE_TERMS.renewalNote.includes('does not stop working'), 'states the customer guarantee');
  assertEqual(LICENCE_TERMS.includedSupportMonths, 6, 'six months included');
});

test('commercial: the payment switch is still off until the backend exists', () => {
  assertEqual(COMMERCE.paymentsEnabled, false, 'paymentsEnabled ships false');
  assertEqual(COMMERCE.accountEnabled, false, 'accountEnabled ships false');
});

test('sql: no invalid privileges are granted or revoked on a sequence', () => {
  // Postgres sequences accept ONLY USAGE and SELECT. Naming INSERT/UPDATE/
  // DELETE/TRUNCATE on a sequence aborts the whole migration (invalid
  // privilege type INSERT for sequence) — which is exactly how the commerce
  // migration died on its first run, leaving public.plans missing.
  const INVALID_SEQUENCE_PRIVILEGE = /\b(insert|update|delete|truncate|references|trigger)\b[^;\n]*\bon[^;\n]*\bsequences?\b/i;

  const files = [
    '../db/migrations/0001_commerce_init.sql',
    '../db/seeds/0001_approved_plans.sql',
  ];

  for (const file of files) {
    const raw = readFileSync(new URL(file, import.meta.url), 'utf8');
    // Strip `--` comments so documentation about the rule is not flagged.
    const sql = raw
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');

    assert(
      !INVALID_SEQUENCE_PRIVILEGE.test(sql),
      `${file} names an invalid privilege on a sequence (only USAGE/SELECT are allowed)`,
    );
  }
});

test('sql: the seed can only run where the migration has created the tables', () => {
  const migration = readFileSync(
    new URL('../db/migrations/0001_commerce_init.sql', import.meta.url),
    'utf8',
  );
  const seed = readFileSync(new URL('../db/seeds/0001_approved_plans.sql', import.meta.url), 'utf8');

  assert(
    /create table public\.plans\b/.test(migration),
    'the migration creates public.plans before the seed runs',
  );
  assert(
    seed.includes('insert into public.plans'),
    'the seed targets the same schema the migration builds',
  );
  assert(
    !/on conflict \(code\) do nothing/.test(seed),
    'the seed updates rather than silently skipping a changed price',
  );
});

test('commercial: seeded plan amounts exactly match the approved package prices', () => {
  // Guards the seed file against the classic pesewas slip (89900 vs 89000):
  // the database is the only thing that decides what a customer is charged,
  // so it must equal the website copy × 100, for every tier.
  const sql = readFileSync(new URL('../db/seeds/0001_approved_plans.sql', import.meta.url), 'utf8');

  for (const pkg of PACKAGES) {
    const rowPattern = new RegExp(`'${pkg.id}'[\\s\\S]*?\\n\\s*(\\d{4,6}),\\n\\s*'GHS'`);
    const match = sql.match(rowPattern);
    assert(match, `seed has a row for ${pkg.id}`);
    assertEqual(
      Number(match[1]),
      pkg.price * 100,
      `${pkg.id} is seeded in pesewas (price × 100)`,
    );
  }

  assertEqual(
    (sql.match(/'GHS',\n    'one_time',\n    6,/g) ?? []).length,
    PACKAGES.length,
    'every seeded plan is a one-time licence granting 6 months of access',
  );
  assertEqual(
    (sql.match(/'samtill-pos',\n    null,\n    true/g) ?? []).length,
    PACKAGES.length,
    'every seeded plan is active with no auto-renewal plan code',
  );
});
