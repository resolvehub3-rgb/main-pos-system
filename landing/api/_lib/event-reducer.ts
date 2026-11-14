/**
 * Pure reduction of provider (Paystack) events into local state transitions.
 *
 * Why a pure function: this is the logic that grants or extends access to
 * paid software, so it must be deterministic and unit-testable without a
 * database or network. The orchestration (dedupe, loading rows, writing
 * patches) lives in apply-reduction.ts; everything here only *decides*.
 *
 * IDEMPOTENCY MODEL (two independent guards):
 *   1. `webhook_events.dedupe_key` is UNIQUE — a provider event is claimed
 *      exactly once (see apply-reduction.ts),
 *   2. an order is `pending -> paid` exactly once: the state transition
 *      itself refuses to re-apply when the order is already `paid`
 *      (outcome `duplicate`). This also stops a webhook and a manual
 *      /api/verify from double-extending an entitlement, because they use
 *      different dedupe keys but the same order.
 *
 * ACCESS MODEL:
 *   - Ghana mobile money cannot be auto-debited by Paystack (official docs:
 *     subscriptions support card + Nigerian direct debit only), so renewals
 *     are typically a NEW order + charge.success that EXTENDS the current
 *     entitlement (stacked onto valid_to — never a gap, never a shortening),
 *   - a failed renewal (`invoice.payment_failed`) marks the subscription
 *     `attention` but NEVER shortens access: the customer keeps access until
 *     valid_to, after which downloads stop automatically,
 *   - cancellation/disable events also never shorten access.
 */

export type IsoString = string;
export type SubscriptionStatus = 'active' | 'attention' | 'non_renewing' | 'cancelled' | 'completed';

export interface OrderState {
  id: string;
  reference: string;
  user_id: string;
  plan_code: string;
  amount_minor: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paid_at: IsoString | null;
  paystack_transaction_id: number | null;
}

export interface EntitlementState {
  id: string;
  user_id: string;
  product_code: string;
  plan_code: string | null;
  source_order_id: string | null;
  status: 'active' | 'expired' | 'revoked';
  valid_from: IsoString;
  valid_to: IsoString;
}

export interface SubscriptionState {
  id: string;
  user_id: string;
  plan_code: string;
  paystack_subscription_code: string | null;
  status: SubscriptionStatus;
  auto_renew: boolean;
  current_period_start: IsoString | null;
  current_period_end: IsoString | null;
  cancel_at_period_end: boolean;
  cancelled_at: IsoString | null;
}

export interface PlanState {
  code: string;
  interval_months: number;
  entitlement_product: string;
}

export interface ProfileState {
  id: string;
}

export interface ProviderEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface ReduceContext {
  event: ProviderEvent;
  order: OrderState | null;
  entitlement: EntitlementState | null;
  subscription: SubscriptionState | null;
  profile: ProfileState | null;
  plan: PlanState | null;
  now: Date;
}

export type ReductionOutcome = 'applied' | 'duplicate' | 'ignored' | 'needs_attention';

export interface Reduction {
  outcome: ReductionOutcome;
  orderAction: 'none' | 'update';
  orderPatch: Partial<OrderState> | null;
  entitlementAction: 'none' | 'create' | 'update';
  entitlementPatch: Partial<EntitlementState> | null;
  subscriptionAction: 'none' | 'create' | 'update';
  subscriptionPatch: Partial<SubscriptionState> | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function base(outcome: ReductionOutcome, notes: string[] = []): Reduction {
  return {
    outcome,
    orderAction: 'none',
    orderPatch: null,
    entitlementAction: 'none',
    entitlementPatch: null,
    subscriptionAction: 'none',
    subscriptionPatch: null,
    notes,
  };
}

/**
 * Add calendar months with day clamping (31 Jan + 1 month = 28/29 Feb),
 * so entitlement windows never silently overshoot into the next month.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const dayOfMonth = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));
  return result;
}

/** When a new paid period starts: stacked after an active window, else now. */
function periodStartMs(entitlement: EntitlementState | null, now: Date): number {
  const nowMs = now.getTime();
  if (!entitlement || entitlement.status !== 'active') return nowMs;
  const currentTo = Date.parse(entitlement.valid_to);
  if (Number.isNaN(currentTo)) return nowMs;
  return Math.max(nowMs, currentTo);
}

/** Extract the identifiers a handler needs in order to load state. */
export interface EventKeys {
  orderReference: string | null;
  subscriptionCode: string | null;
  customerEmail: string | null;
}

export function extractEventKeys(event: ProviderEvent): EventKeys {
  const data = event.data ?? {};

  let orderReference: string | null = typeof data.reference === 'string' ? data.reference : null;
  if (orderReference === null && typeof data.transaction === 'object' && data.transaction !== null) {
    const nested = (data.transaction as Record<string, unknown>).reference;
    if (typeof nested === 'string') orderReference = nested;
  }

  let subscriptionCode: string | null = null;
  const subscription = data.subscription;
  if (typeof subscription === 'object' && subscription !== null) {
    const code = (subscription as Record<string, unknown>).subscription_code;
    if (typeof code === 'string') subscriptionCode = code;
  }
  if (subscriptionCode === null && typeof data.subscription_code === 'string') {
    subscriptionCode = data.subscription_code;
  }
  if (subscriptionCode === null) {
    const metadata = data.metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      const code = (metadata as Record<string, unknown>).paystack_subscription_code;
      if (typeof code === 'string') subscriptionCode = code;
    }
  }

  let customerEmail: string | null = null;
  const customer = data.customer;
  if (typeof customer === 'object' && customer !== null) {
    const email = (customer as Record<string, unknown>).email;
    if (typeof email === 'string') customerEmail = email;
  }
  if (customerEmail === null && typeof data.email === 'string') customerEmail = data.email;

  return {orderReference, subscriptionCode, customerEmail};
}

/**
 * Build the deduplication key for a webhook delivery.
 * Prefers the provider's own object id (stable across retries); falls back
 * to a hash of the raw body so byte-identical redeliveries still collapse.
 */
export function paystackDedupeKey(event: ProviderEvent, rawBodySha256: string): string {
  const data = event.data ?? {};
  const candidate = data.id ?? data.subscription_code ?? data.reference;
  if (candidate !== undefined && candidate !== null) {
    const asString = String(candidate);
    if (asString.length > 0 && asString.length <= 120) {
      return `${event.type}:${asString}`;
    }
  }
  return `${event.type}:sha256:${rawBodySha256}`;
}

/** Map a Paystack subscription status onto our enum (unknown -> active). */
export function mapPaystackSubscriptionStatus(value: unknown): SubscriptionStatus {
  switch (value) {
    case 'active':
    case 'attention':
    case 'non_renewing':
    case 'cancelled':
    case 'completed':
      return value;
    default:
      return 'active';
  }
}

// ---------------------------------------------------------------------------
// per-event reducers
// ---------------------------------------------------------------------------

function reduceChargeSuccess(context: ReduceContext): Reduction {
  const {event, order, entitlement, plan, now} = context;
  const data = event.data ?? {};

  if (!order) {
    return base('needs_attention', ['charge_success_without_matching_order']);
  }
  if (order.status === 'paid') {
    return base('duplicate', ['order_already_paid']);
  }

  // Integrity checks against the provider's copy of what was charged.
  if (typeof data.amount !== 'number' || data.amount !== order.amount_minor) {
    return base('needs_attention', [
      `amount_mismatch_expected_${order.amount_minor}_got_${String(data.amount)}`,
    ]);
  }
  if (typeof data.currency !== 'string' || data.currency.toUpperCase() !== order.currency.toUpperCase()) {
    return base('needs_attention', [
      `currency_mismatch_expected_${order.currency}_got_${String(data.currency)}`,
    ]);
  }

  const reduction = base('applied');
  const paidAt = typeof data.paid_at === 'string' ? data.paid_at : now.toISOString();
  const transactionId = typeof data.id === 'number' ? data.id : null;

  reduction.orderAction = 'update';
  reduction.orderPatch = {status: 'paid', paid_at: paidAt};
  if (transactionId !== null) {
    reduction.orderPatch.paystack_transaction_id = transactionId;
  }

  if (!plan) {
    // Payment recorded, but without a plan we cannot compute an access
    // window. Flagged for manual follow-up rather than guessed.
    reduction.notes.push('plan_missing_entitlement_not_extended');
  } else {
    const startMs = periodStartMs(entitlement, now);
    const endMs = addMonthsClamped(new Date(startMs), plan.interval_months).toISOString();
    const startIso = new Date(startMs).toISOString();

    if (entitlement) {
      reduction.entitlementAction = 'update';
      reduction.entitlementPatch = {
        status: 'active',
        valid_to: endMs,
        plan_code: plan.code,
        source_order_id: order.id,
      };
      if (entitlement.status !== 'active') {
        // Reactivating a previously expired/revoked row restarts its window.
        reduction.entitlementPatch.valid_from = startIso;
      }
      reduction.notes.push('entitlement_extended');
    } else {
      reduction.entitlementAction = 'create';
      reduction.entitlementPatch = {
        user_id: order.user_id,
        product_code: plan.entitlement_product,
        plan_code: plan.code,
        source_order_id: order.id,
        status: 'active',
        valid_from: startIso,
        valid_to: endMs,
      };
      reduction.notes.push('entitlement_created');
    }
  }

  // Link a Paystack subscription when the charge was part of one (only
  // possible for card auto-renew, which is not enabled for Ghana MoMo).
  const subscriptionCode = extractEventKeys(event).subscriptionCode;
  if (subscriptionCode) {
    if (context.subscription) {
      const patch: Partial<SubscriptionState> = {status: 'active', auto_renew: true};
      if (context.subscription.paystack_subscription_code === null) {
        patch.paystack_subscription_code = subscriptionCode;
      }
      reduction.subscriptionAction = 'update';
      reduction.subscriptionPatch = patch;
    } else {
      reduction.subscriptionAction = 'create';
      reduction.subscriptionPatch = {
        user_id: order.user_id,
        plan_code: order.plan_code,
        paystack_subscription_code: subscriptionCode,
        status: 'active',
        auto_renew: true,
        current_period_start: paidAt,
        current_period_end: null,
      };
    }
    reduction.notes.push('subscription_linked');
  }

  return reduction;
}

function reduceInvoicePaymentFailed(context: ReduceContext): Reduction {
  const {subscription} = context;
  if (!subscription) {
    return base('needs_attention', ['invoice_payment_failed_without_matching_subscription']);
  }
  // Access is intentionally untouched: it runs to valid_to (grace window),
  // after which download access stops because entitlement checks read the
  // same valid_to. Paystack does not retry failed subscription charges.
  const reduction = base('applied', ['renewal_failed_access_continues_until_valid_to']);
  reduction.subscriptionAction = 'update';
  reduction.subscriptionPatch = {status: 'attention'};
  return reduction;
}

function reduceSubscriptionCreate(context: ReduceContext): Reduction {
  const {event, subscription, profile, plan} = context;
  const data = event.data ?? {};
  const keys = extractEventKeys(event);

  if (!keys.subscriptionCode) {
    return base('needs_attention', ['subscription_create_missing_code']);
  }

  const status = mapPaystackSubscriptionStatus(data.status);
  const nextPayment = typeof data.next_payment_date === 'string' ? data.next_payment_date : null;

  if (subscription) {
    const patch: Partial<SubscriptionState> = {status, auto_renew: status === 'active'};
    if (subscription.paystack_subscription_code === null) {
      patch.paystack_subscription_code = keys.subscriptionCode;
    }
    if (nextPayment !== null) patch.current_period_end = nextPayment;
    const reduction = base('applied', ['subscription_updated']);
    reduction.subscriptionAction = 'update';
    reduction.subscriptionPatch = patch;
    return reduction;
  }

  // No local row yet. Creating one needs a user (matched by customer email)
  // and a plan; charge.success normally creates the row first, so if either
  // is missing we flag instead of guessing.
  if (!profile || !plan) {
    return base('needs_attention', ['subscription_create_cannot_link_user_or_plan']);
  }

  const reduction = base('applied', ['subscription_created']);
  reduction.subscriptionAction = 'create';
  reduction.subscriptionPatch = {
    user_id: profile.id,
    plan_code: plan.code,
    paystack_subscription_code: keys.subscriptionCode,
    status,
    auto_renew: status === 'active',
    current_period_start: context.now.toISOString(),
    current_period_end: nextPayment,
  };
  return reduction;
}

function reduceSubscriptionDisable(context: ReduceContext): Reduction {
  const {subscription, now} = context;
  if (!subscription) {
    return base('needs_attention', ['subscription_disable_without_matching_subscription']);
  }
  // Cancellation never shortens paid access: entitlements keep their valid_to.
  const reduction = base('applied', ['subscription_cancelled_access_unchanged']);
  reduction.subscriptionAction = 'update';
  reduction.subscriptionPatch = {
    status: 'cancelled',
    auto_renew: false,
    cancelled_at: now.toISOString(),
  };
  return reduction;
}

function reduceSubscriptionNotRenew(context: ReduceContext): Reduction {
  const {subscription} = context;
  if (!subscription) {
    return base('needs_attention', ['subscription_not_renew_without_matching_subscription']);
  }
  const reduction = base('applied', ['subscription_marked_non_renewing']);
  reduction.subscriptionAction = 'update';
  reduction.subscriptionPatch = {
    status: 'non_renewing',
    auto_renew: false,
    cancel_at_period_end: true,
  };
  return reduction;
}

function ignored(type: string, note: string): Reduction {
  return base('ignored', [note, `event_${type}`]);
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

const INFORMATIONAL_EVENTS = new Set([
  'invoice.create',
  'invoice.update',
  'subscription.expiring_cards',
  'charge.dispute.create',
  'charge.dispute.updated',
]);

/**
 * Decide the local effect of one provider event.
 * Unknown event types are ignored (recorded, never applied) — refund and
 * dispute handling is deliberately NOT implemented here because the refund
 * policy is an unresolved commercial decision (docs/01).
 */
export function reducePaystackEvent(context: ReduceContext): Reduction {
  const {type} = context.event;
  switch (type) {
    case 'charge.success':
      return reduceChargeSuccess(context);
    case 'invoice.payment_failed':
      return reduceInvoicePaymentFailed(context);
    case 'subscription.create':
      return reduceSubscriptionCreate(context);
    case 'subscription.disable':
      return reduceSubscriptionDisable(context);
    case 'subscription.not_renew':
      return reduceSubscriptionNotRenew(context);
    default:
      if (INFORMATIONAL_EVENTS.has(type)) return ignored(type, 'informational_event');
      return ignored(type, 'unhandled_event_type');
  }
}
