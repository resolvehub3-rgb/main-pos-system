/**
 * Server-side plan resolution for checkout.
 *
 * SECURITY RULE: the client never supplies a price. Checkout sends only a
 * plan code; the price, currency, interval and entitlement product all come
 * from the `plans` table (server-side). If a request body contains ANY
 * price-like field it is rejected outright instead of silently ignored, so
 * a tampered client cannot create ambiguity about what was charged.
 *
 * Plans themselves are only inserted into the database after the owner
 * approves the commercial decisions (docs/01-commercial-decisions.md), and
 * /api/plans additionally withholds them until PUBLISH_PRICES=true.
 */

export interface PlanRow {
  code: string;
  name: string;
  amount_minor: number;
  currency: string;
  interval_months: number;
  entitlement_product: string;
  active: boolean;
}

/** Public shape returned by GET /api/plans (no internal identifiers). */
export interface PublicPlan {
  code: string;
  name: string;
  amountMinor: number;
  currency: string;
  intervalMonths: number;
}

const CLIENT_PRICE_FIELDS = [
  'amount',
  'amountMinor',
  'amount_minor',
  'price',
  'currency',
  'interval',
  'intervalMonths',
  'interval_months',
] as const;

export type PlanResolution =
  | {ok: true; plan: PlanRow}
  | {ok: false; error: string; message: string};

export function resolveCheckoutPlan(plans: PlanRow[], body: unknown): PlanResolution {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {ok: false, error: 'invalid_request', message: 'Expected a JSON object body.'};
  }
  const record = body as Record<string, unknown>;

  for (const field of CLIENT_PRICE_FIELDS) {
    if (field in record) {
      return {
        ok: false,
        error: 'client_price_not_allowed',
        message: 'Prices are set by the server. Do not send price fields.',
      };
    }
  }

  const planCode = record.planCode;
  if (typeof planCode !== 'string' || planCode.trim() === '') {
    return {ok: false, error: 'plan_required', message: 'Choose a plan to continue.'};
  }

  const plan = plans.find((candidate) => candidate.code === planCode.trim());
  if (!plan) {
    return {ok: false, error: 'plan_not_found', message: 'That plan does not exist.'};
  }
  if (!plan.active) {
    return {ok: false, error: 'plan_inactive', message: 'That plan is not available for purchase right now.'};
  }

  return {ok: true, plan};
}

export function toPublicPlan(plan: PlanRow): PublicPlan {
  return {
    code: plan.code,
    name: plan.name,
    amountMinor: plan.amount_minor,
    currency: plan.currency,
    intervalMonths: plan.interval_months,
  };
}
