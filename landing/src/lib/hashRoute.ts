/**
 * Marketing + Customer Account routing helpers (pure).
 *
 * Supports BOTH:
 *   1. Clean browser pathnames for the public marketing website:
 *        `/`, `/features`, `/pricing`, `/about`, `/contact`, `/download`
 *      and customer billing/account pages:
 *        `/account`, `/checkout`, `/verify`, `/forgot-password`, `/reset-password`
 *   2. Hash routes for full static backwards compatibility (`#/register`,
 *      `#/login`, `#/checkout`, `#/pricing`, etc.).
 */

export const MARKETING_ROUTES = [
  '/',
  '/features',
  '/pricing',
  '/about',
  '/contact',
  '/download',
] as const;

export type MarketingRoute = (typeof MARKETING_ROUTES)[number];

export const ACCOUNT_ROUTES = [
  '/register',
  '/login',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/account',
  '/checkout',
  '/admin',
] as const;

export type AccountRoute = (typeof ACCOUNT_ROUTES)[number];

export interface ParsedRoute {
  path: string;
  params: URLSearchParams;
}

function splitFragment(raw: string): {path: string; query: string} {
  const fragment = raw.startsWith('#') ? raw.slice(1) : raw;
  const index = fragment.indexOf('?');
  if (index === -1) return {path: fragment, query: ''};
  return {path: fragment.slice(0, index), query: fragment.slice(index + 1)};
}

function normalizePath(rawPath: string): string {
  if (!rawPath || rawPath === '/') return '/';
  const trimmed = rawPath.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Parse the current location (hash + search + optional pathname) into a route.
 * Hash routes (`#/checkout`) take precedence when present so `#/login` and
 * `#/register` continue working without colliding with `/app/login`.
 */
export function parseRoute(hash: string, search: string, pathname = '/'): ParsedRoute {
  const realQuery = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(realQuery);

  if (hash.startsWith('#/')) {
    const {path, query} = splitFragment(hash);
    const fromHash = new URLSearchParams(query);
    fromHash.forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
    return {path: normalizePath(path), params};
  }

  const normalizedPath = normalizePath(pathname);
  if (normalizedPath !== '/') {
    return {path: normalizedPath, params};
  }

  return {path: '/', params};
}

export function isAccountRoute(path: string): path is AccountRoute {
  return (ACCOUNT_ROUTES as readonly string[]).includes(path);
}

export function isMarketingRoute(path: string): path is MarketingRoute {
  return (MARKETING_ROUTES as readonly string[]).includes(path);
}

export type VerificationParams =
  | {mode: 'otp'; tokenHash: string; type: string}
  | {mode: 'code'; code: string}
  | null;

export function verificationParams(params: URLSearchParams): VerificationParams {
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && type) {
    return {mode: 'otp', tokenHash, type};
  }
  const code = params.get('code');
  if (code) {
    return {mode: 'code', code};
  }
  return null;
}

/** Route to send the customer to after signing in (default: account page). */
export function nextRouteAfterSignIn(params: URLSearchParams): AccountRoute {
  const next = params.get('next');
  if (next === 'register') return '/register';
  if (next === 'checkout') return '/checkout';
  return '/account';
}
