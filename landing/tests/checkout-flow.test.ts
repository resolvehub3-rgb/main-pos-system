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
import {PACKAGES, PRICING_APPROVED, SUBSCRIPTION_PLAN, SUBSCRIPTION_TERMS} from '../src/config/pricing.ts';
import {COMMERCE} from '../src/config/commerce.ts';

const API = 'https://api.example.com';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', ...headers},
  });
}

const PLAN_ROW = {
  code: 'samtill-pos-6m',
  name: 'SamTill POS — 6-Month Subscription',
  amountMinor: 50000,
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
    assertEqual(result.plans[0].amountMinor, 50000, 'server amount survives');
    assertEqual(result.plans[0].intervalMonths, 6);
  }
});

test('plans: a malformed 200 body never becomes a price', () => {
  const missingField = classifyPlansResponse(200, {
    plans: [{code: 'samtill-pos-6m', name: '6-Month Subscription', amountMinor: 'free', currency: 'GHS', intervalMonths: 6}],
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
    assertEqual(result.plan.amountMinor, 50000, 'price came from the server');
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
    planCode: 'samtill-pos-6m',
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
  assertEqual(observed.body, {planCode: 'samtill-pos-6m'}, 'only the plan code is sent — never a price');
});

test('checkout: a thrown network error becomes a safe result, not a crash', async () => {
  const result = await startCheckout({
    apiBase: '',
    accessToken: 't',
    planCode: 'samtill-pos-6m',
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

test('verify: pending, cancelled and failed payments stay distinct', () => {
  const pending = classifyVerifyResponse(402, {
    error: 'payment_not_successful',
    message: 'Payment status is "pending".',
  });
  assert(!pending.ok && pending.kind === 'payment_pending');
  assert(!pending.retryable, 'the customer decides when to check again');
  assert(pending.message.includes('pending'), 'provider status shown honestly');

  const cancelled = classifyVerifyResponse(402, {
    error: 'payment_cancelled',
    message: 'Payment was cancelled before completion.',
  });
  assert(!cancelled.ok && cancelled.kind === 'payment_cancelled' && !cancelled.retryable);

  const failed = classifyVerifyResponse(402, {
    error: 'payment_failed',
    message: 'Payment failed.',
  });
  assert(!failed.ok && failed.kind === 'payment_failed' && !failed.retryable);
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
    entitlements: [{...ENTITLEMENT, planCode: 'samtill-pos-6m'}],
  });
  assert(result.ok, 'licence list parses');
  if (result.ok) {
    assertEqual(result.entitlements.length, 1);
    assertEqual(result.entitlements[0].planCode, 'samtill-pos-6m');
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

test('display: minor units format cleanly as GH₵500.00', () => {
  assertEqual(formatMinorAmount(50000, 'GHS'), 'GH₵500.00');
  assertEqual(formatMinorAmount(49950, 'GHS'), 'GH₵499.50');
  assertEqual(formatMinorAmount(10000, 'NGN'), '₦100.00', 'unknown-but-known currency symbol');
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
// Approved commercial copy (Single 6-Month Subscription)
// ---------------------------------------------------------------------------

test('commercial: pricing is a single GH₵500.00 6-Month Subscription plan', () => {
  assertEqual(PRICING_APPROVED, true, 'PRICING_APPROVED is true');
  assertEqual(PACKAGES.length, 1, 'exactly one subscription package exists');
  assertEqual(SUBSCRIPTION_PLAN.id, 'samtill-pos-6m');
  assertEqual(SUBSCRIPTION_PLAN.productName, 'SamTill POS');
  assertEqual(SUBSCRIPTION_PLAN.name, '6-Month Subscription');
  assertEqual(SUBSCRIPTION_PLAN.price, 500);
  assertEqual(SUBSCRIPTION_PLAN.amountMinor, 50000);
  assertEqual(SUBSCRIPTION_PLAN.durationLabel, '6 Months');
  assertEqual(SUBSCRIPTION_PLAN.durationMonths, 6);
  assertEqual(SUBSCRIPTION_PLAN.paymentType, 'Single upfront payment');
});

test('commercial: subscription terms describe 6 calendar months activation without legacy drafts', () => {
  assertEqual(SUBSCRIPTION_TERMS.durationMonths, 6);
  assert(!SUBSCRIPTION_TERMS.renewalNote.includes('finalised'), 'renewal note is final');
  assert(!SUBSCRIPTION_TERMS.renewalNote.includes('before launch'), 'no "before launch" wording');
  assert(SUBSCRIPTION_TERMS.summary.includes('GH₵500.00'), 'summary mentions GH₵500.00');
});

test('commercial: paymentsEnabled switch is enabled for online checkout', () => {
  assertEqual(COMMERCE.paymentsEnabled, true, 'paymentsEnabled is enabled');
  assertEqual(COMMERCE.accountEnabled, true, 'accountEnabled ships true');
});

test('commercial: legacy Starter, Business, and Professional tiers are absent from UI copy', () => {
  const filesToScan = [
    '../src/config/pricing.ts',
    '../src/components/Pricing.tsx',
    '../src/components/Faq.tsx',
    '../src/pages/CheckoutPage.tsx',
  ];
  for (const file of filesToScan) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert(!/\b(Starter|Business|Professional)\b/.test(src), `${file} has no legacy tier names`);
    assert(!/\bEnquire about\b/i.test(src), `${file} has no legacy Enquire buttons`);
  }
  const contactSrc = readFileSync(new URL('../src/config/contact.ts', import.meta.url), 'utf8')
    .replace(/Business hours/gi, '');
  assert(!/\b(Starter|Business|Professional)\b/.test(contactSrc), 'contact.ts has no legacy tier names');
});

test('sql: no invalid privileges are granted or revoked on a sequence', () => {
  const INVALID_SEQUENCE_PRIVILEGE = /\b(insert|update|delete|truncate|references|trigger)\b[^;\n]*\bon[^;\n]*\bsequences?\b/i;

  const files = [
    '../db/migrations/0001_commerce_init.sql',
    '../db/seeds/0001_approved_plans.sql',
  ];

  for (const file of files) {
    const raw = readFileSync(new URL(file, import.meta.url), 'utf8');
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

test('commercial: seeded plan exactly matches GH₵500.00 (50000 pesewas) 6-month subscription and deactivates old tiers', () => {
  const sql = readFileSync(new URL('../db/seeds/0001_approved_plans.sql', import.meta.url), 'utf8');

  const rowPattern = /'samtill-pos-6m'[\s\S]*?\n\s*(\d{4,6}),\n\s*'GHS'/;
  const match = sql.match(rowPattern);
  assert(match, 'seed has a row for samtill-pos-6m');
  assertEqual(Number(match[1]), SUBSCRIPTION_PLAN.amountMinor, 'seeded in pesewas (50000)');

  assert(
    sql.includes("set active = false") && sql.includes("'starter', 'business', 'professional'"),
    'deactivates legacy three-tier plans',
  );
  assertEqual(
    (sql.match(/'GHS',\n    'one_time',\n    6,/g) ?? []).length,
    1,
    'exactly one active 6-month upfront subscription plan seeded',
  );
  assertEqual(
    (sql.match(/'samtill-pos',\n    null,\n    true/g) ?? []).length,
    1,
    'exactly one active plan row seeded',
  );
});
