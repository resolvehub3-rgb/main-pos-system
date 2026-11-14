/**
 * GET /api/status — configuration and endpoint overview for reviewers.
 *
 * STATUS: implemented (no backend required).
 *
 * Exposes only variable NAMES of missing/invalid configuration and boolean
 * feature flags — never values, never keys. Useful to confirm that the
 * deployment is inert until the owner provisions the commerce backend.
 */

import {getCommerceConfig, readEnabledByDefaultFlag, readFlag} from './_lib/env.ts';
import {json, methodGuard} from './_lib/http.ts';

const ENDPOINTS: Array<{method: string; path: string; status: string}> = [
  {method: 'GET', path: '/api/status', status: 'implemented'},
  {method: 'GET', path: '/api/plans', status: 'implemented_requires_backend'},
  {method: 'POST', path: '/api/checkout', status: 'implemented_requires_backend'},
  {method: 'POST', path: '/api/verify', status: 'implemented_requires_backend'},
  {method: 'POST', path: '/api/webhooks/paystack', status: 'implemented_requires_backend'},
  {method: 'GET', path: '/api/subscription', status: 'implemented_requires_backend'},
  {method: 'POST', path: '/api/subscription', status: 'skeleton_not_implemented'},
  {method: 'POST', path: '/api/contact', status: 'implemented_requires_backend'},
];

export function GET(request: Request): Response {
  const guard = methodGuard(request, 'GET');
  if (guard) return guard;

  const configResult = getCommerceConfig();

  return json({
    service: 'samtill-commerce',
    phase: configResult.ok ? 'ready' : 'unconfigured',
    description:
      'SamTill customer commerce API. Connects to the SamTill POS Supabase backend and Paystack when environment variables are configured.',
    backendConfigured: configResult.ok,
    missing: configResult.ok ? [] : configResult.missing,
    invalid: configResult.ok ? [] : configResult.invalid,
    flags: {
      checkoutEnabled: readEnabledByDefaultFlag('CHECKOUT_ENABLED'),
      publishPrices: readEnabledByDefaultFlag('PUBLISH_PRICES'),
      allowLivePayments: readFlag('ALLOW_LIVE_PAYMENTS'),
    },
    endpoints: ENDPOINTS,
    documentation: [
      'landing/docs/01-commercial-decisions.md',
      'landing/docs/02-commerce-architecture.md',
      'landing/docs/03-environment-variables.md',
    ],
  });
}
