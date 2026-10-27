/**
 * GET  /api/subscription — the caller's subscription and entitlement state.
 * POST /api/subscription — subscription management actions.
 *
 * STATUS: GET implemented; requires the commerce backend (503 until
 *         configured). Read-only and safe once provisioned.
 *         POST is a SKELETON: `cancel` returns 501 because the cancellation
 *         policy is an unresolved commercial decision
 *         (docs/01-commercial-decisions.md). It must not be implemented
 *         before the owner approves what cancellation means (immediate vs
 *         end of period, refunds).
 *
 * SECURITY: reads are scoped to the signed-in user via the service role and
 * only ever return that user's rows. No browser RLS path exists.
 */

import {loadEntitlementsForUser, loadSubscriptionForUser, type SubscriptionRowFull} from './_lib/context.ts';
import {getCommerceConfig} from './_lib/env.ts';
import {apiError, json, methodGuard, notConfigured, readJsonBody} from './_lib/http.ts';
import {requireSession} from './_lib/session.ts';

function serializeSubscription(row: SubscriptionRowFull | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    planCode: row.plan_code,
    status: row.status,
    autoRenew: row.auto_renew,
    providerSubscriptionCode: row.paystack_subscription_code,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelledAt: row.cancelled_at,
  };
}

export async function GET(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'GET');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  const session = await requireSession(request, config);
  if (!session.ok) return session.response;

  try {
    const [subscription, entitlements] = await Promise.all([
      loadSubscriptionForUser(config, session.user.userId),
      loadEntitlementsForUser(config, session.user.userId),
    ]);

    return json({
      subscription: serializeSubscription(subscription),
      entitlements: entitlements.map((row) => ({
        productCode: row.product_code,
        status: row.status,
        planCode: row.plan_code,
        validFrom: row.valid_from,
        validTo: row.valid_to,
      })),
    });
  } catch (cause) {
    console.error(`commerce: GET /api/subscription failed: ${String(cause)}`);
    return apiError(502, 'backend_unavailable', 'Could not load your subscription right now.');
  }
}

interface SubscriptionActionBody {
  action?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'POST');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  const session = await requireSession(request, config);
  if (!session.ok) return session.response;

  const body = await readJsonBody<SubscriptionActionBody>(request, 4 * 1024);
  if (!body.ok) return body.response;

  const action = body.value.action;
  if (action === 'cancel') {
    // SKELETON — deliberately unimplemented (see file header).
    return apiError(501, 'not_implemented', 'Subscription cancellation is not available yet.', {
      extra: {
        reason: 'cancellation_policy_pending_approval',
        documentation: 'landing/docs/01-commercial-decisions.md',
      },
    });
  }

  return apiError(400, 'unknown_action', 'Unsupported subscription action.');
}
