/**
 * POST /api/verify — server-side verification of a payment reference.
 *
 * STATUS: implemented; requires the commerce backend AND approval flags for
 *         checkout to have produced orders (fails closed with 503 while the
 *         backend is unconfigured).
 *
 * SECURITY MODEL — this is the ONLY path a frontend redirect may trigger:
 *   - the client sends just `{reference}`; nothing in the query string or
 *     body is trusted,
 *   - the order must belong to the signed-in user (404 otherwise, so
 *     references cannot be probed),
 *   - the provider is asked directly (GET /transaction/verify/:reference)
 *     and the response is checked against OUR order: status, amount,
 *     currency and metadata.user_id must all match,
 *   - the actual state change runs through the same claim/reduce/apply
 *     pipeline as webhooks (idempotent; never double-extends access).
 *
 * NOTE: verify does not require CHECKOUT_ENABLED on purpose — payments that
 * were already started stay verifiable if checkout is switched off, so a
 * customer is never stranded after paying.
 */

import {applyProviderEvent, type ApplyResult} from './_lib/apply-reduction.ts';
import {writeAudit} from './_lib/audit.ts';
import {
  loadEntitlementForUser,
  loadOrder,
  loadReduceContext,
  type EntitlementRowFull,
  type OrderRow,
} from './_lib/context.ts';
import {getCommerceConfig} from './_lib/env.ts';
import type {ProviderEvent} from './_lib/event-reducer.ts';
import {
  apiError,
  json,
  methodGuard,
  notConfigured,
  rateLimited,
  readJsonBody,
} from './_lib/http.ts';
import {verifyTransaction, type VerifiedTransaction} from './_lib/paystack-client.ts';
import {checkRateLimit, sharedBuckets} from './_lib/rate-limit.ts';
import {requireSession} from './_lib/session.ts';

const VERIFY_RATE = {limit: 20, windowMs: 10 * 60 * 1000};
const REFERENCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface VerifyBody {
  reference?: unknown;
}

function summarizeEntitlement(row: EntitlementRowFull | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    productCode: row.product_code,
    status: row.status,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

export async function POST(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'POST');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  const session = await requireSession(request, config);
  if (!session.ok) return session.response;

  const rate = checkRateLimit(
    sharedBuckets,
    `verify:${session.user.userId}`,
    VERIFY_RATE,
    Date.now(),
  );
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const body = await readJsonBody<VerifyBody>(request, 4 * 1024);
  if (!body.ok) return body.response;

  const reference = body.value.reference;
  if (typeof reference !== 'string' || !REFERENCE_RE.test(reference)) {
    return apiError(400, 'invalid_reference', 'Invalid payment reference.');
  }

  let order: OrderRow | null;
  try {
    order = await loadOrder(config, reference);
  } catch (cause) {
    console.error(`commerce: verify order load failed: ${String(cause)}`);
    return apiError(502, 'backend_unavailable', 'Could not check the payment right now. Please try again.');
  }

  // Same 404 whether the reference is unknown or someone else's.
  if (!order || order.user_id !== session.user.userId) {
    return apiError(404, 'order_not_found', 'No payment found for that reference.');
  }

  if (order.status === 'paid') {
    const entitlement = await loadEntitlementForUser(config, order.user_id).catch(() => null);
    return json({
      status: 'paid',
      reference: order.reference,
      outcome: 'already_verified',
      entitlement: summarizeEntitlement(entitlement),
    });
  }

  let verified: VerifiedTransaction;
  try {
    verified = await verifyTransaction(config, reference);
  } catch (cause) {
    console.error(`commerce: paystack verify failed: ${String(cause)}`);
    return apiError(502, 'verification_unavailable', 'Could not confirm the payment with the provider. Please try again shortly.');
  }

  if (verified.status !== 'success') {
    return apiError(402, 'payment_not_successful', `Payment status is "${verified.status}".`);
  }

  // Integrity: the provider's copy must match what we ordered.
  if (verified.amount !== order.amount_minor) {
    await writeAudit(config, {
      actorUserId: session.user.userId,
      actorSystem: 'authenticated',
      action: 'verify_amount_mismatch',
      entity: 'order',
      entityId: order.reference,
      metadata: {expected: order.amount_minor, received: verified.amount},
    });
    return apiError(409, 'amount_mismatch', 'Payment amount does not match the order.');
  }
  if (verified.currency.toUpperCase() !== order.currency.toUpperCase()) {
    return apiError(409, 'currency_mismatch', 'Payment currency does not match the order.');
  }
  const metaUserId = verified.metadata.user_id;
  if (typeof metaUserId === 'string' && metaUserId !== order.user_id) {
    await writeAudit(config, {
      actorUserId: session.user.userId,
      actorSystem: 'authenticated',
      action: 'verify_metadata_mismatch',
      entity: 'order',
      entityId: order.reference,
      metadata: {expected_user: order.user_id},
    });
    return apiError(409, 'metadata_mismatch', 'Payment could not be matched to this account.');
  }

  // Synthesise the same event shape webhooks deliver, then run the shared
  // pipeline so both paths produce identical state transitions.
  const event: ProviderEvent = {
    type: 'charge.success',
    data: {
      id: verified.id,
      reference: order.reference,
      amount: verified.amount,
      currency: verified.currency,
      paid_at: verified.paidAt ?? new Date().toISOString(),
      metadata: verified.metadata,
    },
  };

  let result: ApplyResult;
  try {
    result = await applyProviderEvent(
      config,
      {
        dedupeKey: `verify:${order.reference}`,
        source: 'transaction_verify',
        event,
        payload: {
          reference: order.reference,
          transaction_id: verified.id,
          status: verified.status,
        },
      },
      (keys) => loadReduceContext(config, event, keys, {order}),
    );
  } catch (cause) {
    console.error(`commerce: verify apply failed: ${String(cause)}`);
    return apiError(502, 'recording_failed', 'Payment confirmed but could not be recorded. Please try again shortly.');
  }

  const outcome = result.reduction?.outcome;

  if (result.claim === 'duplicate' && outcome === undefined) {
    // This verify attempt was already seen and did not finish — re-check.
    const refreshed = await loadOrder(config, order.reference).catch(() => null);
    if (refreshed?.status === 'paid') {
      const entitlement = await loadEntitlementForUser(config, order.user_id).catch(() => null);
      return json({
        status: 'paid',
        reference: order.reference,
        outcome: 'already_verified',
        entitlement: summarizeEntitlement(entitlement),
      });
    }
    return apiError(502, 'recording_in_progress', 'The payment is still being recorded. Please try again shortly.');
  }

  if (outcome === 'needs_attention') {
    return apiError(
      409,
      'payment_recording_needs_review',
      'Payment confirmed but recording needs review. Please contact support with your reference.',
      {extra: {reference: order.reference, notes: result.reduction?.notes ?? []}},
    );
  }

  const entitlement = await loadEntitlementForUser(config, order.user_id).catch(() => null);
  return json({
    status: 'paid',
    reference: order.reference,
    outcome: outcome ?? 'unknown',
    entitlement: summarizeEntitlement(entitlement),
  });
}
