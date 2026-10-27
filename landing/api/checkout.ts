/**
 * POST /api/checkout — start a Paystack hosted checkout for a plan.
 *
 * STATUS: implemented; requires the commerce backend AND explicit approval.
 *         Fails closed with 503 `checkout_disabled` until CHECKOUT_ENABLED=true
 *         (which must only be set after the commercial decisions in
 *         docs/01-commercial-decisions.md are approved). No live credentials
 *         exist; the config loader additionally refuses non-test Paystack keys
 *         unless ALLOW_LIVE_PAYMENTS=true.
 *
 * Flow:
 *   1. rate limit per IP,
 *   2. require a commerce Supabase session (Bearer token),
 *   3. resolve the plan SERVER-SIDE — any client-supplied price field is
 *      rejected (client_price_not_allowed),
 *   4. insert a `pending` order with a server-generated reference,
 *   5. initialise a hosted Paystack transaction at the database price,
 *   6. return the hosted authorization URL (no card data touches this server).
 *
 * Deliberately sends NO Paystack `plan` parameter: this is a one-time charge
 * (prepaid access period). Card auto-renewal is an unresolved decision.
 */

import {writeAudit} from './_lib/audit.ts';
import {getCommerceConfig} from './_lib/env.ts';
import {
  apiError,
  clientIp,
  json,
  methodGuard,
  notConfigured,
  rateLimited,
  readJsonBody,
} from './_lib/http.ts';
import {resolveCheckoutPlan, toPublicPlan, type PlanRow} from './_lib/plans.ts';
import {PaystackError, initializeTransaction} from './_lib/paystack-client.ts';
import {checkRateLimit, sharedBuckets} from './_lib/rate-limit.ts';
import {requireSession} from './_lib/session.ts';
import type {OrderRow} from './_lib/context.ts';
import {insertRow, selectRows, updateRows, BackendError} from './_lib/supabase.ts';

const PLAN_COLUMNS = 'code,name,amount_minor,currency,interval_months,entitlement_product,active';
const CHECKOUT_RATE = {limit: 10, windowMs: 10 * 60 * 1000};

interface CheckoutBody {
  planCode?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'POST');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  if (!config.checkoutEnabled) {
    return apiError(503, 'checkout_disabled', 'Online checkout is not available yet. Please enquire to purchase.', {
      extra: {documentation: 'landing/docs/01-commercial-decisions.md'},
    });
  }

  const ip = clientIp(request) ?? 'unknown';
  const rate = checkRateLimit(sharedBuckets, `checkout:${ip}`, CHECKOUT_RATE, Date.now());
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const session = await requireSession(request, config);
  if (!session.ok) return session.response;

  const body = await readJsonBody<CheckoutBody>(request, 8 * 1024);
  if (!body.ok) return body.response;

  let plans: PlanRow[];
  try {
    plans = await selectRows<PlanRow>(config, 'plans', `select=${PLAN_COLUMNS}`);
  } catch (cause) {
    console.error(`commerce: checkout plan load failed: ${String(cause)}`);
    return apiError(502, 'backend_unavailable', 'Could not load plans right now. Please try again shortly.');
  }

  const resolution = resolveCheckoutPlan(plans, body.value);
  if (!resolution.ok) {
    return apiError(400, resolution.error, resolution.message);
  }
  const plan = resolution.plan;

  if (!session.user.email) {
    return apiError(400, 'email_required', 'Your account needs an email address before you can pay.');
  }

  // Server-generated reference: unpredictable, matches the orders constraint.
  const reference = `st_${crypto.randomUUID().replace(/-/g, '')}`;

  let order: OrderRow;
  try {
    const inserted = await insertRow<OrderRow>(config, 'orders', {
      user_id: session.user.userId,
      plan_code: plan.code,
      amount_minor: plan.amount_minor,
      currency: plan.currency,
      reference,
      status: 'pending',
    });
    const row = inserted[0];
    if (!row) throw new BackendError('order insert returned no row', 502);
    order = row;
  } catch (cause) {
    console.error(`commerce: checkout order insert failed: ${String(cause)}`);
    return apiError(502, 'checkout_unavailable', 'Could not start checkout right now. Please try again shortly.');
  }

  try {
    const initialized = await initializeTransaction(config, {
      email: session.user.email,
      amountMinor: plan.amount_minor,
      currency: plan.currency,
      reference,
      callbackUrl: `${config.appBaseUrl}/?checkout=return`,
      metadata: {
        user_id: session.user.userId,
        plan_code: plan.code,
        source: 'samtill_commerce',
      },
    });

    await updateRows(config, 'orders', `reference=eq.${encodeURIComponent(reference)}`, {
      paystack_authorization_url: initialized.authorizationUrl,
    });

    await writeAudit(config, {
      actorUserId: session.user.userId,
      actorSystem: 'authenticated',
      action: 'checkout_initiated',
      entity: 'order',
      entityId: reference,
      metadata: {plan_code: plan.code, amount_minor: plan.amount_minor, currency: plan.currency},
    });

    return json({
      reference,
      authorizationUrl: initialized.authorizationUrl,
      plan: toPublicPlan(plan),
    });
  } catch (cause) {
    // The pending order stays behind; it never becomes paid without a
    // verified charge, so it is harmless.
    console.error(`commerce: checkout init failed: ${String(cause)}`);
    if (cause instanceof PaystackError) {
      return apiError(502, 'paystack_unavailable', 'The payment provider is unavailable. Please try again shortly.');
    }
    return apiError(502, 'checkout_failed', 'Could not start checkout. Please try again shortly.');
  }
}
