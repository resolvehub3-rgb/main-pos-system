/**
 * GET /api/plans — server-controlled plan and price list.
 *
 * STATUS: implemented; requires the commerce backend (fails closed with 503
 *         until SUPABASE_COMMERCE_* variables are configured). Not yet
 *         exercised against a live database.
 *
 * Behaviour:
 *  - 403 `pricing_not_approved` until PUBLISH_PRICES=true, so draft prices
 *    never leave the server before the owner approves them
 *    (docs/01-commercial-decisions.md),
 *  - prices are read from the `plans` table only — the browser never sends
 *    or caches an authoritative price,
 *  - `cache-control: no-store`.
 */

import {getCommerceConfig} from './_lib/env.ts';
import {apiError, json, methodGuard, notConfigured} from './_lib/http.ts';
import {toPublicPlan, type PlanRow} from './_lib/plans.ts';
import {selectRows} from './_lib/supabase.ts';

const PLAN_COLUMNS = 'code,name,amount_minor,currency,interval_months,entitlement_product,active';

export async function GET(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'GET');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  if (!config.publishPrices) {
    return apiError(403, 'pricing_not_approved', 'Prices are not published yet. Please enquire for current pricing.', {
      extra: {documentation: 'landing/docs/01-commercial-decisions.md'},
    });
  }

  try {
    const plans = await selectRows<PlanRow>(
      config,
      'plans',
      `select=${PLAN_COLUMNS}&active=eq.true&order=amount_minor.asc`,
    );
    return json({plans: plans.map(toPublicPlan)});
  } catch (cause) {
    console.error(`commerce: GET /api/plans failed: ${String(cause)}`);
    return apiError(502, 'backend_unavailable', 'Could not load plans right now. Please try again shortly.');
  }
}
