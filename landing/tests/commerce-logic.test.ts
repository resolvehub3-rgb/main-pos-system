/**
 * Core commerce logic tests: event reducer (access granting), entitlement
 * download decisions, plan resolution, rate limiting, dedupe-key derivation.
 *
 * These are the decisions that grant or refuse access to paid software, so
 * they run against fixed clocks and fixed payloads — no network, no DB.
 */

import {
  addMonthsClamped,
  extractEventKeys,
  mapPaystackSubscriptionStatus,
  paystackDedupeKey,
  reducePaystackEvent,
  type EntitlementState,
  type OrderState,
  type PlanState,
  type ProviderEvent,
  type ReduceContext,
  type SubscriptionState,
} from '../api/_lib/event-reducer.ts';
import {
  evaluateDownloadAccess,
  toDownloadEventResult,
  type EntitlementRow,
} from '../api/_lib/entitlement.ts';
import {resolveCheckoutPlan, toPublicPlan, type PlanRow} from '../api/_lib/plans.ts';
import {checkRateLimit, type RateLimitBuckets} from '../api/_lib/rate-limit.ts';
import {assert, assertEqual, test} from './harness.ts';

const NOW = new Date('2026-06-15T12:00:00.000Z');

// ---------------------------------------------------------------------------
// factories
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<PlanState> = {}): PlanState {
  return {code: 'business', interval_months: 6, entitlement_product: 'samtill-pos', ...overrides};
}

function makeOrder(overrides: Partial<OrderState> = {}): OrderState {
  return {
    id: 'ord-0001',
    reference: 'st_abc123def456',
    user_id: 'user-1',
    plan_code: 'business',
    amount_minor: 89900, // GH₵899.00 in pesewas
    currency: 'GHS',
    status: 'pending',
    paid_at: null,
    paystack_transaction_id: null,
    ...overrides,
  };
}

function makeEntitlement(overrides: Partial<EntitlementState> = {}): EntitlementState {
  return {
    id: 'ent-0001',
    user_id: 'user-1',
    product_code: 'samtill-pos',
    plan_code: 'business',
    source_order_id: 'ord-0000',
    status: 'active',
    valid_from: '2026-01-10T00:00:00.000Z',
    valid_to: '2026-12-15T12:00:00.000Z',
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    id: 'sub-0001',
    user_id: 'user-1',
    plan_code: 'business',
    paystack_subscription_code: 'sub_900',
    status: 'active',
    auto_renew: true,
    current_period_start: '2026-01-15T12:00:00.000Z',
    current_period_end: '2026-07-15T12:00:00.000Z',
    cancel_at_period_end: false,
    cancelled_at: null,
    ...overrides,
  };
}

function chargeSuccessEvent(overrides: Record<string, unknown> = {}): ProviderEvent {
  return {
    type: 'charge.success',
    data: {
      id: 555001,
      reference: 'st_abc123def456',
      amount: 89900,
      currency: 'GHS',
      paid_at: '2026-06-15T12:05:00.000Z',
      metadata: {user_id: 'user-1', plan_code: 'business'},
      ...overrides,
    },
  };
}

function makeContext(overrides: Partial<ReduceContext> & {event: ProviderEvent}): ReduceContext {
  return {
    order: null,
    entitlement: null,
    subscription: null,
    profile: null,
    plan: makePlan(),
    now: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reducer: first payment
// ---------------------------------------------------------------------------

test('first successful charge marks the order paid and creates an entitlement', () => {
  const reduction = reducePaystackEvent(makeContext({event: chargeSuccessEvent(), order: makeOrder()}));

  assertEqual(reduction.outcome, 'applied');
  assertEqual(reduction.orderAction, 'update');
  assertEqual(reduction.orderPatch?.status, 'paid');
  assertEqual(reduction.orderPatch?.paystack_transaction_id, 555001);
  assertEqual(reduction.entitlementAction, 'create');
  assertEqual(reduction.entitlementPatch?.user_id, 'user-1');
  assertEqual(reduction.entitlementPatch?.product_code, 'samtill-pos');
  assertEqual(reduction.entitlementPatch?.status, 'active');
  // 6-month plan from "now"
  assertEqual(reduction.entitlementPatch?.valid_from, '2026-06-15T12:00:00.000Z');
  assertEqual(reduction.entitlementPatch?.valid_to, '2026-12-15T12:00:00.000Z');
});

test('a second charge for an already-paid order is a duplicate (no double grant)', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: chargeSuccessEvent(), order: makeOrder({status: 'paid', paid_at: '2026-06-15T12:05:00.000Z'})}),
  );

  assertEqual(reduction.outcome, 'duplicate');
  assertEqual(reduction.orderAction, 'none');
  assertEqual(reduction.entitlementAction, 'none');
  assertEqual(reduction.notes[0], 'order_already_paid');
});

test('amount mismatch is refused and nothing is applied', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: chargeSuccessEvent({amount: 100}), order: makeOrder()}),
  );

  assertEqual(reduction.outcome, 'needs_attention');
  assertEqual(reduction.orderAction, 'none');
  assertEqual(reduction.entitlementAction, 'none');
  assert(reduction.notes[0]?.startsWith('amount_mismatch'), `unexpected notes: ${reduction.notes.join(',')}`);
});

test('missing amount in the payload is refused (fail closed)', () => {
  const event = chargeSuccessEvent();
  delete (event.data as Record<string, unknown>).amount;
  const reduction = reducePaystackEvent(makeContext({event, order: makeOrder()}));

  assertEqual(reduction.outcome, 'needs_attention');
  assertEqual(reduction.orderAction, 'none');
});

test('currency mismatch is refused', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: chargeSuccessEvent({currency: 'NGN'}), order: makeOrder()}),
  );

  assertEqual(reduction.outcome, 'needs_attention');
  assertEqual(reduction.orderAction, 'none');
});

test('charge without a matching order is flagged, never guessed', () => {
  const reduction = reducePaystackEvent(makeContext({event: chargeSuccessEvent(), order: null}));

  assertEqual(reduction.outcome, 'needs_attention');
  assertEqual(reduction.notes[0], 'charge_success_without_matching_order');
});

test('missing plan: payment recorded but entitlement deliberately not extended', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: chargeSuccessEvent(), order: makeOrder(), plan: null}),
  );

  assertEqual(reduction.outcome, 'applied');
  assertEqual(reduction.orderPatch?.status, 'paid');
  assertEqual(reduction.entitlementAction, 'none');
  assert(reduction.notes.includes('plan_missing_entitlement_not_extended'));
});

// ---------------------------------------------------------------------------
// reducer: renewals and stacking
// ---------------------------------------------------------------------------

test('renewal stacks onto the end of an active window (no gap, no shortening)', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: chargeSuccessEvent(), order: makeOrder(), entitlement: makeEntitlement()}),
  );

  assertEqual(reduction.outcome, 'applied');
  assertEqual(reduction.entitlementAction, 'update');
  // Window ends 2026-12-15; +6 months => 2027-06-15.
  assertEqual(reduction.entitlementPatch?.valid_to, '2027-06-15T12:00:00.000Z');
  // valid_from must stay untouched while reactivating an active row.
  assert(!('valid_from' in (reduction.entitlementPatch ?? {})), 'valid_from must not be reset on extension');
  assertEqual(reduction.entitlementPatch?.source_order_id, 'ord-0001');
});

test('a lapsed window restarts from now', () => {
  const reduction = reducePaystackEvent(
    makeContext({
      event: chargeSuccessEvent(),
      order: makeOrder(),
      entitlement: makeEntitlement({valid_to: '2026-03-01T00:00:00.000Z'}),
    }),
  );

  assertEqual(reduction.entitlementPatch?.valid_to, '2026-12-15T12:00:00.000Z');
});

test('a revoked entitlement is reactivated with a fresh valid_from', () => {
  const reduction = reducePaystackEvent(
    makeContext({
      event: chargeSuccessEvent(),
      order: makeOrder(),
      entitlement: makeEntitlement({status: 'revoked'}),
    }),
  );

  assertEqual(reduction.entitlementPatch?.status, 'active');
  assertEqual(reduction.entitlementPatch?.valid_from, '2026-06-15T12:00:00.000Z');
  assertEqual(reduction.entitlementPatch?.valid_to, '2026-12-15T12:00:00.000Z');
});

test('charge.success carrying a subscription code links/creates the subscription', () => {
  const reduction = reducePaystackEvent(
    makeContext({
      event: chargeSuccessEvent({subscription: {subscription_code: 'sub_901'}}),
      order: makeOrder(),
    }),
  );

  assertEqual(reduction.subscriptionAction, 'create');
  assertEqual(reduction.subscriptionPatch?.paystack_subscription_code, 'sub_901');
  assertEqual(reduction.subscriptionPatch?.user_id, 'user-1');
  assertEqual(reduction.subscriptionPatch?.auto_renew, true);
  assert(reduction.notes.includes('subscription_linked'));
});

// ---------------------------------------------------------------------------
// reducer: failure, cancellation, grace
// ---------------------------------------------------------------------------

test('failed renewal marks attention but never shortens access', () => {
  const event: ProviderEvent = {
    type: 'invoice.payment_failed',
    data: {subscription: {subscription_code: 'sub_900'}, status: 'pending'},
  };
  const reduction = reducePaystackEvent(
    makeContext({event, subscription: makeSubscription(), entitlement: makeEntitlement()}),
  );

  assertEqual(reduction.outcome, 'applied');
  assertEqual(reduction.subscriptionPatch?.status, 'attention');
  assertEqual(reduction.entitlementAction, 'none');
  assert(reduction.notes.includes('renewal_failed_access_continues_until_valid_to'));
});

test('failed renewal without a matching subscription is flagged', () => {
  const event: ProviderEvent = {type: 'invoice.payment_failed', data: {subscription: {subscription_code: 'sub_x'}}};
  const reduction = reducePaystackEvent(makeContext({event, subscription: null}));

  assertEqual(reduction.outcome, 'needs_attention');
});

test('cancellation keeps entitlement untouched (access runs to valid_to)', () => {
  const event: ProviderEvent = {type: 'subscription.disable', data: {subscription_code: 'sub_900'}};
  const reduction = reducePaystackEvent(
    makeContext({event, subscription: makeSubscription(), entitlement: makeEntitlement()}),
  );

  assertEqual(reduction.outcome, 'applied');
  assertEqual(reduction.subscriptionPatch?.status, 'cancelled');
  assertEqual(reduction.subscriptionPatch?.auto_renew, false);
  assertEqual(reduction.subscriptionPatch?.cancelled_at, NOW.toISOString());
  assertEqual(reduction.entitlementAction, 'none');
});

test('subscription.not_renew marks non_renewing without touching access', () => {
  const event: ProviderEvent = {type: 'subscription.not_renew', data: {subscription_code: 'sub_900'}};
  const reduction = reducePaystackEvent(makeContext({event, subscription: makeSubscription()}));

  assertEqual(reduction.subscriptionPatch?.status, 'non_renewing');
  assertEqual(reduction.subscriptionPatch?.cancel_at_period_end, true);
  assertEqual(reduction.entitlementAction, 'none');
});

test('subscription.create updates an existing row from provider status', () => {
  const event: ProviderEvent = {
    type: 'subscription.create',
    data: {subscription_code: 'sub_900', status: 'active', next_payment_date: '2026-07-15T12:00:00.000Z'},
  };
  const reduction = reducePaystackEvent(
    makeContext({event, subscription: makeSubscription({paystack_subscription_code: null})}),
  );

  assertEqual(reduction.subscriptionAction, 'update');
  assertEqual(reduction.subscriptionPatch?.paystack_subscription_code, 'sub_900');
  assertEqual(reduction.subscriptionPatch?.current_period_end, '2026-07-15T12:00:00.000Z');
});

test('subscription.create without a linkable user/plan is flagged, not guessed', () => {
  const event: ProviderEvent = {type: 'subscription.create', data: {subscription_code: 'sub_902', status: 'active'}};
  const reduction = reducePaystackEvent(makeContext({event, profile: null, plan: null}));

  assertEqual(reduction.outcome, 'needs_attention');
  assertEqual(reduction.notes[0], 'subscription_create_cannot_link_user_or_plan');
});

test('subscription.create with profile+plan creates the row', () => {
  const event: ProviderEvent = {type: 'subscription.create', data: {subscription_code: 'sub_902', status: 'active'}};
  const reduction = reducePaystackEvent(
    makeContext({event, profile: {id: 'user-7'}, plan: makePlan({code: 'starter'})}),
  );

  assertEqual(reduction.subscriptionAction, 'create');
  assertEqual(reduction.subscriptionPatch?.user_id, 'user-7');
  assertEqual(reduction.subscriptionPatch?.plan_code, 'starter');
});

test('unknown event types are ignored (never applied)', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: {type: 'some.future.event', data: {}}, order: makeOrder()}),
  );

  assertEqual(reduction.outcome, 'ignored');
  assertEqual(reduction.orderAction, 'none');
});

test('dispute events are ignored pending a refund policy decision', () => {
  const reduction = reducePaystackEvent(
    makeContext({event: {type: 'charge.dispute.create', data: {id: 9}}, order: makeOrder()}),
  );

  assertEqual(reduction.outcome, 'ignored');
});

// ---------------------------------------------------------------------------
// reducer helpers
// ---------------------------------------------------------------------------

test('addMonthsClamped handles short months (31 Jan -> 28 Feb)', () => {
  assertEqual(addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z');
  assertEqual(addMonthsClamped(new Date('2026-12-31T00:00:00.000Z'), 2).toISOString(), '2027-02-28T00:00:00.000Z');
  assertEqual(addMonthsClamped(new Date('2026-06-15T12:00:00.000Z'), 6).toISOString(), '2026-12-15T12:00:00.000Z');
});

test('extractEventKeys finds reference, subscription code and email', () => {
  const keys = extractEventKeys({
    type: 'charge.success',
    data: {
      reference: 'st_abc123def456',
      subscription: {subscription_code: 'sub_900'},
      customer: {email: 'buyer@example.com'},
    },
  });
  assertEqual(keys.orderReference, 'st_abc123def456');
  assertEqual(keys.subscriptionCode, 'sub_900');
  assertEqual(keys.customerEmail, 'buyer@example.com');
});

test('extractEventKeys falls back to metadata for the subscription code', () => {
  const keys = extractEventKeys({
    type: 'charge.success',
    data: {metadata: {paystack_subscription_code: 'sub_903'}, email: 'buyer@example.com'},
  });
  assertEqual(keys.subscriptionCode, 'sub_903');
  assertEqual(keys.customerEmail, 'buyer@example.com');
  assertEqual(keys.orderReference, null);
});

test('paystackDedupeKey prefers the provider object id', () => {
  assertEqual(
    paystackDedupeKey({type: 'charge.success', data: {id: 555001, reference: 'st_x'}}, 'feedface'),
    'charge.success:555001',
  );
  assertEqual(
    paystackDedupeKey({type: 'charge.success', data: {reference: 'st_x'}}, 'feedface'),
    'charge.success:st_x',
  );
  assertEqual(
    paystackDedupeKey({type: 'mystery.event', data: {}}, 'feedface'),
    'mystery.event:sha256:feedface',
  );
});

test('mapPaystackSubscriptionStatus maps known values and defaults safely', () => {
  assertEqual(mapPaystackSubscriptionStatus('attention'), 'attention');
  assertEqual(mapPaystackSubscriptionStatus('cancelled'), 'cancelled');
  assertEqual(mapPaystackSubscriptionStatus('something_new'), 'active');
  assertEqual(mapPaystackSubscriptionStatus(undefined), 'active');
});

// ---------------------------------------------------------------------------
// download entitlement decisions
// ---------------------------------------------------------------------------

const WINDOW: EntitlementRow = {
  product_code: 'samtill-pos',
  status: 'active',
  valid_from: '2026-01-01T00:00:00.000Z',
  valid_to: '2026-12-31T00:00:00.000Z',
};

test('active window grants download access', () => {
  const decision = evaluateDownloadAccess([WINDOW], {now: NOW});
  assertEqual(decision.allowed, true);
  assertEqual(decision.reason, 'granted');
  assertEqual(decision.validTo, WINDOW.valid_to);
});

test('expired window denies with reason "expired"', () => {
  const decision = evaluateDownloadAccess([WINDOW], {now: new Date('2027-01-01T00:00:00.000Z')});
  assertEqual(decision.allowed, false);
  assertEqual(decision.reason, 'expired');
});

test('future window denies with reason "not_yet_active"', () => {
  const decision = evaluateDownloadAccess([WINDOW], {now: new Date('2025-06-01T00:00:00.000Z')});
  assertEqual(decision.allowed, false);
  assertEqual(decision.reason, 'not_yet_active');
});

test('no rows denies with reason "no_entitlement"', () => {
  const decision = evaluateDownloadAccess([], {now: NOW});
  assertEqual(decision.allowed, false);
  assertEqual(decision.reason, 'no_entitlement');
});

test('rows for another product deny with reason "wrong_product"', () => {
  const decision = evaluateDownloadAccess([{...WINDOW, product_code: 'other-app'}], {now: NOW});
  assertEqual(decision.allowed, false);
  assertEqual(decision.reason, 'wrong_product');
});

test('revoked/expired status denies even inside a date window', () => {
  const decision = evaluateDownloadAccess([{...WINDOW, status: 'revoked'}], {now: NOW});
  assertEqual(decision.allowed, false);
  assertEqual(decision.reason, 'inactive_status');
});

test('corrupt dates fail closed', () => {
  const decision = evaluateDownloadAccess([{...WINDOW, valid_to: 'not-a-date'}], {now: NOW});
  assertEqual(decision.allowed, false);
  assertEqual(decision.reason, 'inactive_status');
});

test('the widest remaining window wins when several rows exist', () => {
  const lapsed: EntitlementRow = {...WINDOW, valid_to: '2026-03-01T00:00:00.000Z'};
  const decision = evaluateDownloadAccess([lapsed, WINDOW], {now: NOW});
  assertEqual(decision.allowed, true);
  assertEqual(decision.validTo, WINDOW.valid_to);
});

test('deny reasons map to audit result values', () => {
  assertEqual(toDownloadEventResult({allowed: true, reason: 'granted'}), 'granted');
  assertEqual(toDownloadEventResult({allowed: false, reason: 'no_entitlement'}), 'denied_no_entitlement');
  assertEqual(toDownloadEventResult({allowed: false, reason: 'expired'}), 'denied_expired');
  assertEqual(toDownloadEventResult({allowed: false, reason: 'inactive_status'}), 'denied_inactive');
});

// ---------------------------------------------------------------------------
// plan resolution (client-price rejection)
// ---------------------------------------------------------------------------

const PLANS: PlanRow[] = [
  {
    code: 'starter',
    name: 'Starter',
    amount_minor: 49900,
    currency: 'GHS',
    interval_months: 6,
    entitlement_product: 'samtill-pos',
    active: true,
  },
  {
    code: 'hidden',
    name: 'Hidden',
    amount_minor: 1,
    currency: 'GHS',
    interval_months: 1,
    entitlement_product: 'samtill-pos',
    active: false,
  },
];

test('checkout resolves price from the server row, not the client', () => {
  const resolution = resolveCheckoutPlan(PLANS, {planCode: 'starter'});
  assert(resolution.ok, 'expected resolution to succeed');
  assertEqual(resolution.plan.amount_minor, 49900);
  assertEqual(resolution.plan.currency, 'GHS');
});

test('any client-supplied price field is rejected outright', () => {
  for (const body of [
    {planCode: 'starter', amount: 1},
    {planCode: 'starter', price: 0},
    {planCode: 'starter', amountMinor: 5},
    {planCode: 'starter', currency: 'USD'},
    {planCode: 'starter', intervalMonths: 99},
  ]) {
    const resolution = resolveCheckoutPlan(PLANS, body);
    assert(!resolution.ok, `body ${JSON.stringify(body)} must be rejected`);
    if (!resolution.ok) assertEqual(resolution.error, 'client_price_not_allowed');
  }
});

test('unknown and inactive plans are rejected', () => {
  const unknown = resolveCheckoutPlan(PLANS, {planCode: 'does-not-exist'});
  assert(!unknown.ok && unknown.error === 'plan_not_found');

  const inactive = resolveCheckoutPlan(PLANS, {planCode: 'hidden'});
  assert(!inactive.ok && inactive.error === 'plan_inactive');
});

test('missing plan code and non-object bodies are rejected', () => {
  const missing = resolveCheckoutPlan(PLANS, {});
  assert(!missing.ok && missing.error === 'plan_required');

  for (const body of ['string', 42, [], null]) {
    const resolution = resolveCheckoutPlan(PLANS, body);
    assert(!resolution.ok && resolution.error === 'invalid_request', `body ${JSON.stringify(body)} must be invalid`);
  }
});

test('toPublicPlan exposes only safe camelCase fields', () => {
  const publicPlan = toPublicPlan(PLANS[0]);
  assertEqual(publicPlan, {
    code: 'starter',
    name: 'Starter',
    amountMinor: 49900,
    currency: 'GHS',
    intervalMonths: 6,
  });
});

// ---------------------------------------------------------------------------
// rate limiting
// ---------------------------------------------------------------------------

test('rate limiter allows up to the limit then blocks with retry-after', () => {
  const buckets: RateLimitBuckets = new Map();
  const rule = {limit: 3, windowMs: 60_000};

  const first = checkRateLimit(buckets, 'ip:1.2.3.4', rule, 1_000);
  const second = checkRateLimit(buckets, 'ip:1.2.3.4', rule, 2_000);
  const third = checkRateLimit(buckets, 'ip:1.2.3.4', rule, 3_000);
  const fourth = checkRateLimit(buckets, 'ip:1.2.3.4', rule, 4_000);

  assertEqual([first.allowed, first.remaining], [true, 2]);
  assertEqual([second.allowed, second.remaining], [true, 1]);
  assertEqual([third.allowed, third.remaining], [true, 0]);
  assertEqual(fourth.allowed, false);
  assertEqual(fourth.retryAfterSeconds, 57); // resetAt 61_000 - now 4_000
});

test('rate limit window resets after expiry', () => {
  const buckets: RateLimitBuckets = new Map();
  const rule = {limit: 1, windowMs: 1_000};

  assertEqual(checkRateLimit(buckets, 'k', rule, 0).allowed, true);
  assertEqual(checkRateLimit(buckets, 'k', rule, 500).allowed, false);
  assertEqual(checkRateLimit(buckets, 'k', rule, 1_001).allowed, true);
});

test('rate limit keys are independent', () => {
  const buckets: RateLimitBuckets = new Map();
  const rule = {limit: 1, windowMs: 1_000};

  assertEqual(checkRateLimit(buckets, 'user-a', rule, 0).allowed, true);
  assertEqual(checkRateLimit(buckets, 'user-b', rule, 0).allowed, true);
  assertEqual(checkRateLimit(buckets, 'user-a', rule, 1).allowed, false);
});
